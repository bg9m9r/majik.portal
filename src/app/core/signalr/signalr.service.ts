import { Injectable, inject, signal } from '@angular/core';
import { HttpError, HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Observable, ReplaySubject, Subject, defer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUserStore } from '../auth/auth-user.store';
import {
  BotDecision,
  BotDecisionAlternative,
  BotThinkingPayload,
  ClockUpdatePayload,
  OpponentJoinedPayload,
  PlayDrawChosenPayload,
  PlayerRolledPayload,
  RolledPayload,
  StateChangedPayload,
  TimedOutPayload
} from '../match/match.types';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

// Bounded reconnect backoff (ms between attempts). The SignalR default
// for `withAutomaticReconnect()` with no args is [0, 2000, 10000, 30000]
// then it gives up — but the FIRST retry is immediate, which means a
// revoked session (every reconnect 401s) hammers Auth0 / the negotiate
// endpoint the instant the transport drops. Give it an explicit, bounded
// schedule with a non-zero first delay so a permanently-dead session
// backs off instead of spinning. After the last entry the connection
// transitions to a permanent-failure state (onclose with an error) which
// the UI surfaces as "connection lost".
export const RECONNECT_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000];

@Injectable({ providedIn: 'root' })
export class SignalrService {
  private readonly auth = inject(AuthUserStore);

  private connection: HubConnection | null = null;
  private currentMatchId: string | null = null;

  // One-shot flag flipped by the 401 detection path below. When true, the
  // next `accessTokenFactory` invocation force-refreshes the Auth0 token
  // (cacheMode: 'off') and clears the flag. Default behavior is to return
  // the cached token — forcing a refresh on every connect is what tripped
  // Auth0's `invalid_grant` in prod once refresh-token rotation was on.
  private retryWithFreshToken = false;

  private readonly _state = signal<ConnectionState>('idle');
  private readonly _error = signal<string | null>(null);
  // Permanent-failure latch: set when automatic reconnect exhausts the
  // backoff schedule (or a non-recoverable close happens). The UI reads
  // this to show a manual-recovery affordance instead of a perpetual
  // "reconnecting" spinner. Cleared on a fresh connect().
  private readonly _reconnectFailed = signal<boolean>(false);
  // Session-expiry latch: set when a reconnect / negotiate fails because
  // the session's token was rejected (401) and a forced refresh could not
  // recover it. The UI surfaces "session expired" (toast / redirect to
  // login) rather than silently spinning on a stale token. Cleared on a
  // fresh connect().
  private readonly _sessionExpired = signal<boolean>(false);

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly reconnectFailed = this._reconnectFailed.asReadonly();
  readonly sessionExpired = this._sessionExpired.asReadonly();

  // Engine events (scoped to a match's underlying game).
  //
  // These two channels carry the server-replayed snapshot that JoinMatch
  // streams synchronously after the hub connection opens (see PR #159 on
  // majik.core — the server buffers the most recent prompt/event per
  // match so reconnecting clients catch up without a separate REST hop).
  //
  // The race: SignalrService is providedIn:'root' (single instance) and
  // MatchPage subscribes only AFTER `await signalr.connect()` resolves,
  // but the .on('prompt', ...) handler fires during the awaited
  // invoke('JoinMatch') — i.e. BEFORE the subscription is wired up.
  // A plain Subject drops emissions with no subscribers, so the mulligan
  // prompt vanished. ReplaySubject(1) buffers the most recent value and
  // hands it to the late subscriber, fixing the bot-game mulligan hang.
  //
  // The subjects are recreated by disconnect() so a stale prompt from a
  // prior match cannot leak into a new match's overlay. The public-facing
  // observables `prompt$` / `event$` are defer()'d so each subscriber
  // sees the *current* subject at the moment they subscribe.
  private _event$ = new ReplaySubject<unknown>(1);
  private _prompt$ = new ReplaySubject<unknown>(1);
  // Authoritative game-state snapshot pushed on the "state" channel. The
  // server streams this synchronously after JoinMatch (snapshot-on-join,
  // Slice 4b) so a (re)connecting client re-syncs without a separate REST
  // hop. Buffered with ReplaySubject(1) for the same late-subscriber race
  // as prompt$/event$: the .on('state', …) handler fires during the
  // awaited connect() before MatchPage wires up its subscription.
  private _state$ = new ReplaySubject<unknown>(1);
  readonly event$: Observable<unknown> = defer(() => this._event$);
  readonly prompt$: Observable<unknown> = defer(() => this._prompt$);
  readonly state$: Observable<unknown> = defer(() => this._state$);

  // Match lifecycle event streams
  readonly opponentJoined$ = new Subject<OpponentJoinedPayload>();
  readonly stateChanged$ = new Subject<StateChangedPayload>();
  readonly rolled$ = new Subject<RolledPayload>();
  readonly playDrawChosen$ = new Subject<PlayDrawChosenPayload>();
  readonly clockUpdate$ = new Subject<ClockUpdatePayload>();
  readonly timedOut$ = new Subject<TimedOutPayload>();
  readonly playerRolled$ = new Subject<PlayerRolledPayload>();
  readonly botThinking$ = new Subject<BotThinkingPayload>();
  // Bot decision diagnostics — fed by SignalrBotDecisionSink on the server
  // when Bot:DecisionLogging:Enabled is on. Each emission is a single
  // BotDecision describing one policy pick (Priority / Combat.Attackers
  // / ActivatedAbility / etc.). The wire DTO is normalised here so
  // downstream consumers don't have to tolerate PascalCase/camelCase
  // duality — server-side serialization is currently PascalCase by
  // default System.Text.Json conventions, but BotConfig is the
  // engine's, so we tolerate either.
  readonly botDecisions$ = new Subject<BotDecision>();

  async connect(matchId: string): Promise<void> {
    if (this.connection && this.currentMatchId === matchId) {
      return;
    }
    await this.disconnect();
    this._state.set('connecting');
    this._error.set(null);
    this._reconnectFailed.set(false);
    this._sessionExpired.set(false);
    this.currentMatchId = matchId;

    this.connection = new HubConnectionBuilder()
      .withUrl(environment.signalRHubUrl, {
        // SignalR invokes this on initial connect AND on every reconnect
        // attempt. Return the cached Auth0 token by default — the SDK
        // transparently refreshes it when near expiry. Forcing a refresh
        // every time (the previous behavior) caused Auth0 to reject the
        // rotated refresh token with `invalid_grant` in prod once rapid
        // reconnects drifted local + tenant state out of sync.
        //
        // Only force a refresh after a confirmed 401 negotiate (set by
        // the start()/onreconnecting() catch blocks below). Self-clearing
        // so a single failure can't lock us into perpetual force-refresh.
        accessTokenFactory: () => {
          if (this.retryWithFreshToken) {
            this.retryWithFreshToken = false;
            return this.auth.forceRefresh();
          }
          return this.auth.getAccessToken();
        }
      })
      // Bounded backoff (see RECONNECT_BACKOFF_MS) — non-zero first delay
      // so a revoked session doesn't hammer Auth0/the negotiate endpoint
      // the instant the transport drops. When the schedule is exhausted
      // the connection closes with an error → onclose surfaces the
      // permanent-failure state below.
      .withAutomaticReconnect([...RECONNECT_BACKOFF_MS])
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on('event', (evt: unknown) => this._event$.next(evt));
    this.connection.on('prompt', (p: unknown) => this._prompt$.next(p));
    // Snapshot-on-join (Slice 4b): authoritative GameState pushed after
    // (re)joining. Feed into GameStore.setState so a reconnect re-syncs.
    this.connection.on('state', (s: unknown) => this._state$.next(s));
    this.connection.on('match.opponent-joined', (p: OpponentJoinedPayload) => this.opponentJoined$.next(p));
    this.connection.on('match.state-changed', (p: StateChangedPayload) => this.stateChanged$.next(p));
    this.connection.on('match.rolled', (p: RolledPayload) => this.rolled$.next(p));
    this.connection.on('match.play-draw-chosen', (p: PlayDrawChosenPayload) => this.playDrawChosen$.next(p));
    this.connection.on('match.clock-update', (p: ClockUpdatePayload) => this.clockUpdate$.next(p));
    this.connection.on('match.timed-out', (p: TimedOutPayload) => this.timedOut$.next(p));
    this.connection.on('match.player-rolled', (p: PlayerRolledPayload) => this.playerRolled$.next(p));
    this.connection.on('match.bot-thinking', (p: BotThinkingPayload) => this.botThinking$.next(p));
    this.connection.on('bot-decision', (p: unknown) => {
      const normalised = SignalrService.normaliseBotDecision(p);
      if (normalised) this.botDecisions$.next(normalised);
    });

    this.connection.onclose(err => this.handleClose(err));
    this.connection.onreconnecting(err => {
      // If the previous transport dropped because the server rejected our
      // token, arm a one-shot force-refresh so the upcoming reconnect's
      // accessTokenFactory invocation pulls a fresh JWT. Anything else
      // (network blip, idle timeout) reuses the cached token.
      if (SignalrService.isAuthError(err)) {
        this.retryWithFreshToken = true;
      }
      this._state.set('connecting');
    });
    this.connection.onreconnected(() => {
      // A successful reconnect clears the transient error/expiry latches.
      // The server re-streams a snapshot on the "state" channel after the
      // re-JoinMatch so GameStore re-syncs authoritative state.
      this._state.set('open');
      this._error.set(null);
      this._reconnectFailed.set(false);
      this._sessionExpired.set(false);
    });

    try {
      await this.connection.start();
      await this.connection.invoke('JoinMatch', matchId);
      this._state.set('open');
    } catch (err: unknown) {
      // Initial negotiate rejected our token: force one refresh + retry
      // a single time. If the second attempt still 401s the user's
      // session is genuinely dead and we surface the error normally.
      if (SignalrService.isAuthError(err) && !this.retryWithFreshToken) {
        this.retryWithFreshToken = true;
        try {
          await this.connection.start();
          await this.connection.invoke('JoinMatch', matchId);
          this._state.set('open');
          return;
        } catch (retryErr: unknown) {
          this._state.set('error');
          this._error.set(retryErr instanceof Error ? retryErr.message : String(retryErr));
          // Second negotiate still rejected: the session is dead even
          // after a forced token refresh — surface "session expired".
          if (SignalrService.isAuthError(retryErr)) {
            this._sessionExpired.set(true);
          }
          throw retryErr;
        }
      }
      this._state.set('error');
      this._error.set(err instanceof Error ? err.message : String(err));
      if (SignalrService.isAuthError(err)) {
        this._sessionExpired.set(true);
      }
      throw err;
    }
  }

  /**
   * Handle a connection close. Extracted from the `onclose` callback so
   * it's directly unit-testable without a live HubConnection.
   *
   * A close WITHOUT an error is a clean stop (disconnect()). A close WITH
   * an error means automatic-reconnect exhausted its backoff schedule (or
   * the close was otherwise non-recoverable): the client is permanently
   * disconnected until a manual recovery. We latch `reconnectFailed` so
   * the UI offers a reconnect/refresh affordance rather than a perpetual
   * "reconnecting" spinner; and if the cause was a 401 we latch
   * `sessionExpired` so the user re-authenticates instead of the client
   * silently retrying a stale token.
   */
  private handleClose(err?: Error): void {
    this._state.set(err ? 'error' : 'closed');
    if (err) {
      this._error.set(err.message);
      this._reconnectFailed.set(true);
      if (SignalrService.isAuthError(err)) {
        this._sessionExpired.set(true);
      }
    }
  }

  /**
   * Returns true when an error looks like an auth rejection from the
   * SignalR negotiate (HTTP 401) — the only signal we treat as "force
   * one token refresh and try again". Anything else (transport, 5xx,
   * generic Error) falls through to normal error handling so we don't
   * accidentally hammer Auth0's /oauth/token endpoint.
   */
  static isAuthError(err: unknown): boolean {
    return err instanceof HttpError && err.statusCode === 401;
  }

  /**
   * Coerce a raw bot-decision wire payload into the portal's BotDecision
   * shape. Exported as a static so tests can drive the mapping directly
   * without needing a live HubConnection.
   *
   * Server-side System.Text.Json defaults serialize properties as
   * PascalCase, but the JSON contract has historically been mixed
   * (camelCase elsewhere in the codebase), so we accept both casings on
   * every key. Missing required fields → return null and drop the
   * envelope; better silence than a half-populated card on the panel.
   */
  static normaliseBotDecision(raw: unknown): BotDecision | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const decisionType = (r['decisionType'] ?? r['DecisionType']) as string | undefined;
    const chosen = (r['chosen'] ?? r['Chosen']) as string | undefined;
    if (!decisionType || !chosen) return null;
    const score = Number(r['chosenScore'] ?? r['ChosenScore'] ?? 0);
    const rawAlts = (r['alternatives'] ?? r['Alternatives'] ?? []) as unknown[];
    const alts: BotDecisionAlternative[] = Array.isArray(rawAlts)
      ? rawAlts
          .map(a => {
            if (!a || typeof a !== 'object') return null;
            const ar = a as Record<string, unknown>;
            const name = (ar['name'] ?? ar['Name']) as string | undefined;
            if (!name) return null;
            return { name, score: Number(ar['score'] ?? ar['Score'] ?? 0) };
          })
          .filter((a): a is BotDecisionAlternative => a !== null)
      : [];
    const rawCtx = (r['context'] ?? r['Context'] ?? {}) as Record<string, unknown>;
    const ctx: Record<string, string> = {};
    if (rawCtx && typeof rawCtx === 'object') {
      for (const [k, v] of Object.entries(rawCtx)) {
        ctx[k] = v == null ? '' : String(v);
      }
    }
    return {
      decisionType,
      chosen,
      chosenScore: Number.isFinite(score) ? score : 0,
      alternatives: alts,
      context: ctx,
      receivedAt: Date.now(),
    };
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;
    try {
      if (this.connection.state === HubConnectionState.Connected && this.currentMatchId) {
        await this.connection.invoke('LeaveMatch', this.currentMatchId);
      }
      await this.connection.stop();
    } catch {
      // ignore — best effort cleanup
    }
    this.connection = null;
    this.currentMatchId = null;
    this._state.set('idle');
    this._reconnectFailed.set(false);
    this._sessionExpired.set(false);
    // Replace replay buffers so a stale prompt/event/state from the
    // previous match doesn't leak into the next match's subscribers. The
    // public `prompt$` / `event$` / `state$` observables defer() to these
    // fields, so any subscription wired up after the next connect() will
    // see the fresh buffer (and any prompts/events/state replayed by
    // JoinMatch on the new connection).
    this._event$.complete();
    this._prompt$.complete();
    this._state$.complete();
    this._event$ = new ReplaySubject<unknown>(1);
    this._prompt$ = new ReplaySubject<unknown>(1);
    this._state$ = new ReplaySubject<unknown>(1);
  }
}
