import { Injectable, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { Observable, ReplaySubject, Subject, defer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
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

@Injectable({ providedIn: 'root' })
export class SignalrService {
  private readonly auth = inject(AuthService);

  private connection: HubConnection | null = null;
  private currentMatchId: string | null = null;

  private readonly _state = signal<ConnectionState>('idle');
  private readonly _error = signal<string | null>(null);

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();

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
  readonly event$: Observable<unknown> = defer(() => this._event$);
  readonly prompt$: Observable<unknown> = defer(() => this._prompt$);

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
    this.currentMatchId = matchId;

    this.connection = new HubConnectionBuilder()
      .withUrl(environment.signalRHubUrl, {
        // SignalR invokes this on initial connect AND on every reconnect attempt. Force-refresh
        // the Auth0 access token so reconnects after a long disconnect don't reuse an expired JWT.
        accessTokenFactory: () => this.auth.refresh()
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on('event', (evt: unknown) => this._event$.next(evt));
    this.connection.on('prompt', (p: unknown) => this._prompt$.next(p));
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

    this.connection.onclose(err => {
      this._state.set(err ? 'error' : 'closed');
      if (err) this._error.set(err.message);
    });
    this.connection.onreconnecting(() => this._state.set('connecting'));
    this.connection.onreconnected(() => this._state.set('open'));

    try {
      await this.connection.start();
      await this.connection.invoke('JoinMatch', matchId);
      this._state.set('open');
    } catch (err: unknown) {
      this._state.set('error');
      this._error.set(err instanceof Error ? err.message : String(err));
      throw err;
    }
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
    // Replace replay buffers so a stale prompt/event from the previous
    // match doesn't leak into the next match's subscribers. The public
    // `prompt$` / `event$` observables defer() to these fields, so any
    // subscription wired up after the next connect() will see the fresh
    // buffer (and any prompts/events replayed by JoinMatch on the new
    // connection).
    this._event$.complete();
    this._prompt$.complete();
    this._event$ = new ReplaySubject<unknown>(1);
    this._prompt$ = new ReplaySubject<unknown>(1);
  }
}
