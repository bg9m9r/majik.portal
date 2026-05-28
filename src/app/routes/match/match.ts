import {
  Component,
  DestroyRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatchService } from '../../core/match/match.service';
import { SignalrService } from '../../core/signalr/signalr.service';
import { AuthUserStore } from '../../core/auth/auth-user.store';
import { GameStore } from '../../core/match/game.store';
import { WaitingStateComponent } from './components/waiting-state.component';
import { RollingStateComponent } from './components/rolling-state.component';
import { PlayDrawPromptComponent } from './components/play-draw-prompt.component';
import { CompletedStateComponent } from './components/completed-state.component';
import { BoardComponent } from './components/board.component';
import { BotDecisionsPanelComponent } from './components/bot-decisions-panel.component';
import { PromptOverlayComponent, PromptDecision } from './components/prompt-overlay.component';
import { Router } from '@angular/router';
import { ToastService } from '../../ui/toast.service';
import {
  Ability, BotDecision, CardSnapshot, GameCommand, GameState, Match, MatchError, PromptEnvelope
} from '../../core/match/match.types';
import { ConnectionState } from '../../core/signalr/signalr.service';

@Component({
  selector: 'app-match',
  standalone: true,
  imports: [
    RouterLink,
    WaitingStateComponent,
    RollingStateComponent,
    PlayDrawPromptComponent,
    CompletedStateComponent,
    BoardComponent,
    BotDecisionsPanelComponent,
    PromptOverlayComponent,
  ],
  template: `
    <main class="flex min-h-screen flex-col">
      <header class="flex items-center justify-between border-b border-[color:var(--majik-line)] p-3">
        <div class="flex items-center gap-3">
          <h1 class="majik-h2">Match <code class="majik-code">{{ id }}</code></h1>
          @if (game.selfTimerState(); as t) {
            <span
              class="match-timer"
              [class.match-timer--active]="t.active"
              [class.match-timer--low]="t.low"
              [attr.aria-label]="'your clock: ' + t.text">
              <span class="match-timer__label">YOU</span>
              <span>{{ t.text }}</span>
            </span>
          }
        </div>
        <div class="flex items-center gap-3 text-xs">
          @if (game.fullControl()) {
            <span
              class="full-control-chip"
              role="status"
              aria-label="full control active — auto-pass priority is suppressed">
              ⌃ FULL CONTROL
            </span>
          }
          @if (game.opponentTimerState(); as t) {
            <span
              class="match-timer"
              [class.match-timer--active]="t.active"
              [class.match-timer--low]="t.low"
              [attr.aria-label]="'opponent clock: ' + t.text">
              <span class="match-timer__label">OPP</span>
              <span>{{ t.text }}</span>
            </span>
          }
          @if (connectionIndicator(); as c) {
            <span
              class="rounded border px-2 py-0.5"
              [class.border-amber-400]="c.tone === 'warn'"
              [class.text-amber-200]="c.tone === 'warn'"
              [class.border-red-400]="c.tone === 'error'"
              [class.text-red-200]="c.tone === 'error'"
              role="status"
              [attr.aria-label]="c.label">{{ c.label }}</span>
          }
          <span class="opacity-70">{{ profile.handle() ?? auth.principal()?.sub }}</span>
          <a routerLink="/lobby" class="text-[color:var(--majik-accent)] underline">Back</a>
        </div>
      </header>
      <section class="flex flex-1 flex-col">
        @if (botThinking()) {
          <div class="flex items-center gap-2 border-b border-[color:var(--majik-line)] px-3 py-1 text-sm text-[color:var(--majik-accent)] animate-pulse">
            <span class="inline-block h-2 w-2 rounded-full bg-[color:var(--majik-accent)]"></span>
            Bot is thinking…
          </div>
        }
        @if (fetchError()) {
          <div class="flex items-center justify-between gap-2 border-b border-red-400/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            <span>{{ fetchError() }}</span>
            <button
              type="button"
              class="rounded border border-red-400 px-2 py-0.5 text-xs text-red-100 hover:bg-red-400/10"
              (click)="onManualRefresh()">Refresh</button>
          </div>
        }
        @if (loadError()) {
          <p class="p-6 text-red-300/80">{{ loadError() }}</p>
        } @else if (current(); as m) {
          @switch (m.state) {
            @case ('Open')      { <app-waiting-state [match]="m" /> }
            @case ('Joined')    { <app-rolling-state [match]="m" /> }
            @case ('Starting')  { <app-rolling-state [match]="m" /> }
            @case ('Rolling') {
              <app-rolling-state [match]="m" />
              @if (isRollWinner(m)) {
                <app-play-draw-prompt [match]="m" (choose)="onPlayDraw($event)" />
              }
            }
            @case ('Playing') {
              <app-board
                [state]="game.state()"
                [selfPlayerIds]="game.selfPlayerIds()"
                [currentPrompt]="myPromptSummary()"
                [phaseStops]="game.phaseStops()"
                [liveAssignments]="liveAssignments()"
                (passClicked)="onPass()"
                (castOrPlayRequested)="onHandClicked($event)"
                (phaseStopToggled)="game.togglePhaseStop($event)"
                (concedeClicked)="onConcede()"
                (undoClicked)="onUndoRequested()"
                (tapToggleRequested)="onTapToggleRequested($event)"
                (activateManaRequested)="onActivateManaRequested($event)"
                (activateAbilityRequested)="onActivateAbilityRequested($event)" />
              @if (game.prompt(); as p) {
                @if (game.isMyTurnPrompt()) {
                  <app-prompt-overlay
                    #promptOverlay
                    [state]="game.state()"
                    [prompt]="p"
                    [selfPlayerIds]="game.selfPlayerIds()"
                    (decision)="onPromptDecision($event)"
                    (cancel)="onPromptCancel()"
                    (assignmentsChanged)="onAssignmentsChanged($event)" />
                }
              }
              <app-bot-decisions-panel [decisions]="game.recentDecisions()" />
            }
            @case ('Completed') { <app-completed-state [match]="m" /> }
            @case ('Abandoned') { <app-completed-state [match]="m" /> }
          }
        } @else {
          <p class="p-6 opacity-60">Loading…</p>
        }
      </section>
    </main>
  `,
})
export class MatchPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly matchSvc = inject(MatchService);
  private readonly signalr = inject(SignalrService);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthUserStore);
  readonly profile = this.auth;
  readonly game = inject(GameStore);
  private readonly toast = inject(ToastService);

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly loadError = signal<string | null>(null);
  readonly current = this.matchSvc.current;
  readonly botThinking = signal(false);

  // Transient fetch-failure surface. Set when refresh()/fetchState() hit a
  // !ok result so the board doesn't silently go stale; cleared on the next
  // successful fetch. Drives the in-page error banner + its Refresh button.
  readonly fetchError = signal<string | null>(null);

  // Minimal connection-status indicator view-model. Derived from the
  // SignalR connection state + the permanent-failure / session-expiry
  // latches. Null while healthy (open / idle) so the header stays clean.
  readonly connectionIndicator = computed<{ label: string; tone: 'warn' | 'error' } | null>(() =>
    connectionIndicatorFor(
      this.signalr.state(),
      this.signalr.reconnectFailed(),
      this.signalr.sessionExpired(),
    ));

  // Combat-assignment relay. The prompt overlay emits this whenever
  // the user toggles an attacker / blocker; we hold it here so the
  // board's SVG overlay can draw arrows in real time.
  readonly liveAssignments = signal<{
    kind: 'attackers' | 'blockers' | null;
    attackers?: { attackerInstanceId: string; defenderId: string }[];
    blockers?: { attackerInstanceId: string; blockerInstanceId: string }[];
  } | null>(null);

  // Forward decl — populated when the prompt overlay is mounted via
  // the template-ref ViewChild. Used by the Enter keyboard handler.
  @ViewChild('promptOverlay') promptOverlayRef?: PromptOverlayComponent;

  // Match-session state (clock anchor, full control, stack-mutation
  // tracking, the auto-pass loop + its heartbeats, and the header timer
  // view-models) all live in GameStore now (Slice 2b). The component is
  // a thin binding layer: SignalR clock updates feed
  // game.setClockAnchor, state snapshots feed game.recordStackMutation,
  // the Ctrl toggle calls game.toggleFullControl, and the template binds
  // game.selfTimerState / game.opponentTimerState / game.fullControl.

  // Debounce overlapping re-fetches: every engine event currently
  // triggers a full /state pull. If two land in the same tick we don't
  // need two parallel GETs — a second flight just races. Coalesce by
  // marking a single pending request.
  private statePending = false;

  // Single-writer reconnect guard (Important 3). On the INITIAL hub join
  // the server pushes an authoritative GameState on the "state" channel
  // (snapshot-on-join, Slice 4b) which seeds the board. But SignalR's
  // withAutomaticReconnect() does NOT re-invoke JoinMatch on auto-reconnect
  // (the client's onreconnected handler only resets latches), so the
  // server never re-pushes that snapshot on reconnect — the authoritative
  // reconnect resync is the connecting→open /state REST refetch below.
  //
  // To avoid a dual-writer race (a stale buffered "state" snapshot landing
  // after the fresher /state refetch, flapping the board backward), we
  // collapse to ONE writer: once a reconnect has occurred, the /state
  // refetch owns resync and state$ is no longer fed into setState. state$
  // still seeds the initial join (when this flag is false).
  private reconnectResyncOwnsState = false;

  // Trimmed-down view of the prompt for the action-bar's `currentPrompt`
  // input. The board's <app-action-bar> only cares about the kinds and
  // a description; the full envelope is consumed by the overlay.
  readonly myPromptSummary = computed(() => {
    const p = this.game.prompt();
    if (!p || !this.game.isMyTurnPrompt()) return null;
    return { expectedKinds: p.expectedKinds, description: p.description };
  });

  private rollSubmitted = false;

  readonly ownRoll = computed(() => {
    const m = this.matchSvc.current();
    const sub = this.auth.principal()?.sub;
    if (!m || !sub) return null;
    const isCreator = sub === m.creator.sub;
    return (isCreator ? m.roll?.creatorRoll : m.roll?.opponentRoll) ?? null;
  });

  readonly opponentRoll = computed(() => {
    const m = this.matchSvc.current();
    const sub = this.auth.principal()?.sub;
    if (!m || !sub) return null;
    const isCreator = sub === m.creator.sub;
    return (isCreator ? m.roll?.opponentRoll : m.roll?.creatorRoll) ?? null;
  });

  readonly winnerHandle = computed(() => {
    const m = this.matchSvc.current();
    if (!m?.roll?.winnerSub) return null;
    return m.roll.winnerSub === m.creator.sub ? m.creator.handle : m.opponent?.handle ?? null;
  });

  constructor() {
    // Re-anchor the store's local clock whenever the canonical Match
    // snapshot changes. The server pushes a fresh Match on each
    // clock-update SignalR event (see refresh() in load()), so anchoring
    // off matchSvc.current means the store auto-resyncs every time the
    // server speaks. The store owns the 1Hz tick + countdown derivation.
    effect(() => {
      this.game.setClockAnchor(this.matchSvc.current());
    });
    effect(() => {
      const m = this.matchSvc.current();
      if (m && (m.state === 'Completed' || m.state === 'Abandoned')) {
        this.botThinking.set(false);
      }
    });
    // Session-expiry recovery. A 401 mid-session leaves SignalR's
    // sessionExpired latch set; a forceRefresh that couldn't recover leaves
    // AuthUserStore's sessionExpired latch set. Either means the session is
    // dead — rather than silently spinning on a stale token, surface it
    // once and bounce the user to /login so they re-authenticate. Guarded
    // so it fires a single time per expiry.
    let sessionExpiredHandled = false;
    effect(() => {
      const expired = this.signalr.sessionExpired() || this.auth.sessionExpired();
      if (expired && !sessionExpiredHandled) {
        sessionExpiredHandled = true;
        this.toast.error('Session expired — please sign in again');
        void this.router.navigate(['/login']);
      }
      if (!expired) {
        sessionExpiredHandled = false;
      }
    });
    // Reconnect resync (SINGLE authoritative writer — Important 3). The
    // page bootstraps /state once on entering Playing; a mid-game transport
    // drop + automatic reconnect would otherwise leave the board frozen on
    // the pre-drop snapshot. JoinMatch is NOT re-invoked on auto-reconnect,
    // so the server's "state" snapshot push does NOT arrive on reconnect —
    // the /state REST refetch on the connecting→open transition is the one
    // and only reconnect resync. We flip `reconnectResyncOwnsState` the
    // moment we enter the reconnect window so the state$ subscription (which
    // seeds the initial join) stops writing setState and can't flap the
    // board backward with a stale buffered snapshot.
    let wasConnecting = false;
    effect(() => {
      const st = this.signalr.state();
      if (st === 'connecting') {
        wasConnecting = true;
        // Reconnect window opened: /state refetch now owns resync.
        this.reconnectResyncOwnsState = true;
      } else if (st === 'open' && wasConnecting) {
        wasConnecting = false;
        // Only resync once we're actually playing — earlier states are
        // driven by the match-lifecycle refresh() subscriptions.
        if (this.matchSvc.current()?.state === 'Playing') {
          void this.fetchState();
        }
      }
    });
    // Auto-roll on Rolling state. We deliberately do NOT gate on
    // `auth.principal()` / creator-vs-opponent slot detection here —
    // the server already maps the caller's JWT `sub` onto the correct
    // seat and treats a duplicate `submitRoll` for an already-filled
    // slot as a silent no-op (see `MatchService.SubmitRollAsync` in
    // majik.core). Adding client-side gating was the source of a
    // stuck-on-"ROLL FOR FIRST PLAYER" bug: in a bot match the human's
    // `auth.principal()` can be null while the Auth0 `idTokenClaims$`
    // stream is still bootstrapping, so the effect bailed and never
    // fired. Trust the server: fire once per page lifetime as soon as
    // we see Rolling state, stop once a winner is recorded.
    effect(() => {
      const m = this.matchSvc.current();
      if (!shouldAutoSubmitRoll(m, this.rollSubmitted)) return;
      this.rollSubmitted = true;
      void this.matchSvc.submitRoll(m!.id).then(r => {
        if (!r.ok) this.rollSubmitted = false;
      });
    });
    // First Playing transition pulls the snapshot exactly once. Any
    // subsequent re-snapshot is event-driven (see fetchState below).
    let bootstrapped = false;
    effect(() => {
      const m = this.matchSvc.current();
      if (!m) return;
      if (m.state === 'Playing' && !bootstrapped) {
        bootstrapped = true;
        void this.fetchState();
      }
      if (m.state !== 'Playing') {
        bootstrapped = false;
      }
    });
    // Stack-mutation tracker — feed every observed state snapshot to the
    // store, which hashes it into a cheap signature and stamps the
    // minimum-display timestamp the auto-pass guard reads. The store
    // ignores no-op snapshots (unchanged signature) itself.
    effect(() => {
      this.game.recordStackMutation(this.game.state());
    });
    // Auto-pass priority is now owned by the store (shouldAutoPassNow +
    // the heartbeat-driven runAutoPass loop started in GameStore's
    // onInit hook). No component effect required.
  }

  ngOnInit(): void {
    void this.load();
    // Header-clock + auto-pass heartbeats live in GameStore's withHooks
    // onInit/onDestroy now — the component no longer owns intervals.
  }

  ngOnDestroy(): void {
    this.botThinking.set(false);
    // GameStore.reset() restores all match-session state; the store's
    // own onDestroy hook clears its clock / auto-pass intervals.
    this.game.reset();
    void this.signalr.disconnect();
  }

  private async load(): Promise<void> {
    const r = await this.matchSvc.get(this.id);
    if (!r.ok) { this.loadError.set(r.error.code); return; }
    this.matchSvc.setCurrent(r.value);
    try {
      await this.signalr.connect(this.id);
      // Close the initial-state race: events that fired between the
      // first GET and the SignalR group join would otherwise be lost
      // (e.g. bot-game roll result published before we subscribed).
      // Re-fetch so the roll / state catch up.
      const fresh = await this.matchSvc.get(this.id);
      if (fresh.ok) this.matchSvc.setCurrent(fresh.value);
    } catch {
      // signalr.service surfaces error via state signal; non-fatal for loading
    }
    this.signalr.opponentJoined$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.signalr.stateChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.signalr.rolled$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.signalr.playerRolled$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.signalr.playDrawChosen$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.signalr.clockUpdate$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.signalr.timedOut$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh());
    this.signalr.botThinking$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(p => this.botThinking.set(p.thinking));
    // Bot decision diagnostics — feeds the bottom-right panel. Each
    // BotDecision lands on the ring buffer in GameStore (capped at 10);
    // the panel itself is collapsed by default so the channel is free
    // to be chatty without hurting the board view.
    this.signalr.botDecisions$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(d => {
        this.game.pushBotDecision(d);
        // Surface "big" decisions (mulligan, attacks, blocks, casts,
        // concedes) as a transient toast in addition to the bottom-right
        // panel. The full transcript lives in the panel — the toast is
        // an at-a-glance feed so the user can keep eyes on the board.
        if (isBigBotDecision(d)) {
          this.toast.show(formatBotDecisionToast(d), {
            severity: 'info',
            durationMs: 3500,
          });
        }
      });
    // Engine "event" channel — first try to apply the event as an
    // in-place delta on the existing snapshot (LifeChanged, PhaseStarted,
    // TurnStarted, etc.). Only fall back to a full /state refetch when
    // the patch reducer can't handle the event type or the payload
    // doesn't match the local snapshot. See event.reducer.ts for the
    // patched-vs-deferred event taxonomy.
    this.signalr.event$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(evt => {
        if (!this.game.applyEvent(evt)) {
          void this.fetchState();
        }
      });
    // Per-viewer prompt envelope. The MatchFacadeBridge fans prompts
    // only to the recipient, but we still set into the store regardless
    // and let the page gate the overlay on isMyTurnPrompt for defence
    // in depth.
    this.signalr.prompt$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(p => {
        // The wire DTO uses PascalCase or camelCase depending on
        // System.Text.Json options on the server; tolerate both.
        const raw = p as Record<string, unknown>;
        // Library-search prompts (CR 701.19a) carry an engine-pre-
        // filtered candidate list + a human label on the wire. Mirror
        // both into the envelope so the prompt overlay can render the
        // picker without re-deriving the candidate set from a hidden
        // zone (CR 706).
        const envelope: PromptEnvelope = {
          gameId: String(raw['gameId'] ?? raw['GameId'] ?? ''),
          playerId: String(raw['playerId'] ?? raw['PlayerId'] ?? ''),
          expectedKinds: (raw['expectedKinds'] ?? raw['ExpectedKinds'] ?? []) as string[],
          description: (raw['description'] ?? raw['Description']) as string | undefined,
          candidates: (raw['candidates'] ?? raw['Candidates']) as CardSnapshot[] | undefined,
          label: (raw['label'] ?? raw['Label']) as string | undefined,
        };
        this.game.setPrompt(envelope);
      });
    // Authoritative snapshot pushed on the "state" channel — the server's
    // snapshot-on-join (Slice 4b). The server pushes this synchronously in
    // response to JoinMatch, which the client invokes ONLY on the initial
    // connect (SignalR's auto-reconnect does NOT re-invoke JoinMatch), so
    // this realistically fires once: the initial-join seed. ReplaySubject(1)
    // on the service hands the buffered snapshot to this late subscriber.
    //
    // Single-writer guard (Important 3): once a reconnect window has opened,
    // the connecting→open /state REST refetch is the sole authoritative
    // resync. Suppress state$ writes from that point so a stale buffered
    // snapshot can't land after the fresher refetch and flap the board
    // backward.
    //
    // TODO(reconnect-seq): the ideal long-term fix is a monotonic sequence
    //   gate on GameStore.setState (drop any snapshot whose tick <= the last
    //   applied tick), which would make ordering robust regardless of how
    //   many writers feed it. The server doesn't expose a per-snapshot tick
    //   yet; add one to GameState and gate setState on it, then this
    //   reconnect-window flag can go away.
    this.signalr.state$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(s => {
        if (this.reconnectResyncOwnsState) return;
        this.game.setState(normaliseStateSnapshot(s));
      });
  }

  private async refresh(): Promise<void> {
    const r = await this.matchSvc.get(this.id);
    if (r.ok) {
      this.matchSvc.setCurrent(r.value);
      this.fetchError.set(null);
    } else {
      this.fetchError.set(fetchFailureMessage(r.error));
      this.toast.error(fetchFailureMessage(r.error));
    }
  }

  // Coalesced state fetch. If a request is already in flight, mark a
  // pending re-run so we never miss a late event but also don't stack N
  // parallel /state GETs. The owning loop re-checks the dirty flag at
  // each iteration.
  private stateDirty = false;
  private async fetchState(): Promise<void> {
    if (this.statePending) {
      this.stateDirty = true;
      return;
    }
    this.statePending = true;
    try {
      do {
        this.stateDirty = false;
        const r = await this.matchSvc.getState(this.id);
        if (r.ok) {
          // Tolerate PascalCase or camelCase from the server (mirrors the
          // prompt-envelope mapping above). The server stamps youPlayerId
          // since Slice 2a; older builds or spectator views leave it absent.
          this.game.setState(normaliseStateSnapshot(r.value));
          this.fetchError.set(null);
        } else {
          // Don't drop the failure silently → stale board. Surface a
          // banner + toast + a manual Refresh affordance.
          this.fetchError.set(fetchFailureMessage(r.error));
          this.toast.error(fetchFailureMessage(r.error));
        }
      } while (this.stateDirty);
    } finally {
      this.statePending = false;
    }
  }

  // Manual recovery affordance behind the fetch-error banner's Refresh
  // button. Re-pull the match snapshot and, when playing, the game state.
  async onManualRefresh(): Promise<void> {
    await this.refresh();
    if (this.matchSvc.current()?.state === 'Playing') {
      await this.fetchState();
    }
  }

  isRollWinner(m: Match): boolean {
    return m.roll?.winnerSub === this.auth.principal()?.sub;
  }

  async onPlayDraw(choice: 'play' | 'draw'): Promise<void> {
    await this.matchSvc.playDraw(this.id, { choice });
  }

  // ---------------- Game command dispatch ----------------

  async onPass(): Promise<void> {
    await this.send({ $type: 'pass' });
  }

  // Concede — hits the existing REST endpoint. Engine emits the
  // appropriate Completed/Abandoned transition on its own clock; we
  // don't need to clear local state here, the existing match-state
  // effects will take it from there.
  async onConcede(): Promise<void> {
    const r = await this.matchSvc.concede(this.id);
    if (!r.ok) {
      console.warn('concede failed', r.error);
      this.toast.error(commandRejectionMessage(r.error, 'Could not concede'));
    }
  }

  // Undo — UI stub. The engine doesn't expose an undo command today;
  // logging the request is enough for now. If a prompt is open we
  // also clear it locally so the user can re-issue without waiting
  // for an engine roundtrip.
  // TODO(undo): wire to a real engine-side cancel/undo command once
  //   majik.core exposes one (no GameCommand variant for this yet).
  onUndoRequested(): void {
    console.info('undo requested (no engine-side cancel yet)');
    if (this.game.prompt()) {
      this.game.clearPrompt();
    }
  }

  // Right-click "Tap / Untap" override from the board context menu —
  // stub for now. The engine doesn't expose a direct tap-this-permanent
  // command (taps fall out of activating abilities / declaring attacks),
  // so we log the request as a debug signal until a manual-tap
  // GameCommand variant lands in majik.core.
  // TODO(manual-tap): wire to engine command when one is exposed.
  onTapToggleRequested(card: CardSnapshot): void {
    console.warn('manual tap/untap requested (no engine command yet)', {
      instanceId: card.instanceId,
      name: card.name,
    });
  }

  // Tap-a-land-for-mana → ActivateManaAbilityCommand. The visual tap
  // animation falls out of the next state snapshot updating
  // CardSnapshot.tapped (board.scss handles the 90° rotation).
  async onActivateManaRequested(req: { card: CardSnapshot; color: string }): Promise<void> {
    await this.send({
      $type: 'activateManaAbility',
      permanentInstanceId: req.card.instanceId,
      color: req.color,
    });
  }

  // Non-mana activated ability (e.g. Verdant Catacombs {T}, pay 1 life,
  // sacrifice → search) → ActivateAbilityCommand. The board emits this
  // only when the server has supplied an abilityId via AbilityDto.Id;
  // until the companion core PR deploys the path is unreachable.
  async onActivateAbilityRequested(req: { permanentInstanceId: string; abilityId: string }): Promise<void> {
    await this.send({
      $type: 'activateAbility',
      permanentInstanceId: req.permanentInstanceId,
      abilityId: req.abilityId,
    });
  }

  async onHandClicked(card: CardSnapshot): Promise<void> {
    // Hand-click semantics depend on the active prompt:
    //   * "Bottom" prompt → toggle is handled inside the overlay, this
    //     click is a no-op (the overlay owns its own button list).
    //   * Otherwise → play if it's a land, cast if anything else.
    //
    // Future: when the prompt expects mulligan/x/mode, hand clicks
    // should likely be ignored too; the overlay covers those flows.
    const types = (card.types ?? []).map(t => t.toLowerCase());
    const isLand = types.includes('land');
    if (isLand) {
      await this.send({ $type: 'play-land', landInstanceId: card.instanceId });
      return;
    }
    // Cast — no targets / X / mode yet; engine will respond with a
    // follow-up Targets/X/Mode prompt if the spell requires them.
    await this.send({
      $type: 'cast',
      cardInstanceId: card.instanceId,
      targetInstanceIds: [],
      xValue: null,
      modeIndex: null,
    });
  }

  async onPromptDecision(decision: PromptDecision): Promise<void> {
    const cmd = this.translateDecision(decision);
    if (!cmd) return;
    // Clear locally before round-trip so the overlay collapses without
    // waiting for the engine's follow-up state pull. If the command is
    // rejected the prompt will simply re-arrive on the next prompt$
    // message.
    this.game.clearPrompt();
    this.liveAssignments.set(null);
    await this.send(cmd);
  }

  onPromptCancel(): void {
    // No server-side cancel today — clearing locally lets the user
    // dismiss a prompt overlay; the engine will resend on its next tick
    // if it's still waiting.
    this.game.clearPrompt();
    this.liveAssignments.set(null);
  }

  onAssignmentsChanged(a: {
    kind: 'attackers' | 'blockers';
    attackers?: { attackerInstanceId: string; defenderId: string }[];
    blockers?: { attackerInstanceId: string; blockerInstanceId: string }[];
  }): void {
    this.liveAssignments.set(a);
  }

  // ---------------- Keyboard shortcuts (Task 2) ----------------
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(evt: KeyboardEvent): void {
    // Full Control — press-once toggle on the bare Ctrl / Meta key.
    // `evt.repeat` is filtered so OS auto-repeat doesn't fire the
    // toggle multiple times while the key is held. Combination keys
    // (Ctrl+R, Ctrl+Tab, Ctrl+digit) keep their normal browser
    // behaviour because those keydowns surface as the OTHER key with
    // `ctrlKey` set, not as `evt.key === 'Control'`.
    if ((evt.key === 'Control' || evt.key === 'Meta') && !evt.repeat) {
      this.game.toggleFullControl();
    }
    dispatchMatchKey(evt, {
      hasActionPrompt: () => !!this.myPromptSummary(),
      hasPrompt: () => !!this.game.prompt(),
      isMyTurnPrompt: () => this.game.isMyTurnPrompt(),
      handCards: () => {
        const me = this.game.state()?.players.find(p => this.game.selfPlayerIds().includes(p.id));
        return me?.hand.cards ?? [];
      },
      pass: () => { void this.onPass(); },
      cancelPrompt: () => this.onPromptCancel(),
      confirmPrimary: () => this.promptOverlayRef?.tryConfirmPrimary() ?? false,
      playHandCard: (c: CardSnapshot) => { void this.onHandClicked(c); },
    });
  }

  private translateDecision(d: PromptDecision): GameCommand | null {
    switch (d.kind) {
      case 'targets':
        return { $type: 'targets', targetInstanceIds: d.targetInstanceIds ?? [] };
      case 'mulligan':
        return { $type: 'mulligan', keep: d.keep ?? false };
      case 'x':
        return { $type: 'x', x: d.x ?? 0 };
      case 'mode':
        return { $type: 'mode', modeIndex: d.modeIndex ?? 0 };
      case 'attackers':
        return { $type: 'attackers', attackers: d.attackers ?? [] };
      case 'blockers':
        return { $type: 'blockers', blockers: d.blockers ?? [] };
      case 'bottom':
        return { $type: 'bottom', cardInstanceIds: d.cardInstanceIds ?? [] };
      case 'mana':
        return { $type: 'mana', sourceInstanceIds: d.sourceInstanceIds ?? [] };
      case 'mana-cancel':
        return { $type: 'cancelCast' };
      case 'libraryPick':
        // CR 701.19a — wire null for "find nothing" (legal); the server
        // rejects ids outside the offered candidate set with a clear
        // error so a stale selection can never silently mis-tutor.
        return {
          $type: 'chooseLibraryPick',
          selectedInstanceId: d.selectedInstanceId ?? null,
        };
      default:
        return null;
    }
  }

  private async send(cmd: GameCommand): Promise<void> {
    const r = await this.matchSvc.submitCommand(this.id, cmd);
    if (!r.ok) {
      console.warn('submitCommand failed', cmd, r.error);
      // Surface the engine rejection so the user knows the action didn't
      // land — including the engine's reason when the API returns one.
      this.toast.error(commandRejectionMessage(r.error, 'Move rejected'));
    }
  }
}

// "Big" bot decision filter — these are the moments that change the
// board state in a way the user wants to see called out:
//   * Mulligan kept / sent
//   * Attacks declared
//   * Blocks declared
//   * Spell cast
//   * Concede
// Smaller decisions (per-priority pumps, idle passes) stay in the
// bottom-right diagnostics panel only.
const BIG_DECISION_TOKENS = ['mulligan', 'attack', 'block', 'cast', 'concede'] as const;
function isBigBotDecision(d: BotDecision): boolean {
  const t = (d.decisionType ?? '').toLowerCase();
  return BIG_DECISION_TOKENS.some(tok => t.includes(tok));
}

/**
 * Compact "<bot name> — <decisionType>: <chosen>" string for the toast.
 * The bot name is pulled from the decision context bag when available
 * (the server stamps `botName` / `playerName`); falls back to a neutral
 * "Bot" label so the toast still reads if the server omits it.
 */
function formatBotDecisionToast(d: BotDecision): string {
  const ctx = d.context ?? {};
  const name = ctx['botName'] ?? ctx['playerName'] ?? ctx['name'] ?? 'Bot';
  return `${name} — ${d.decisionType}: ${d.chosen}`;
}

/**
 * Adapter the keyboard dispatcher reads — kept structural so the unit
 * spec can stub each method without spinning up the entire MatchPage.
 */
export interface MatchKeyDeps {
  /** True when an action-bar prompt is active (mirrors action-bar.canPass). */
  hasActionPrompt(): boolean;
  /** True when ANY prompt is active (used for Escape cancellation). */
  hasPrompt(): boolean;
  /** True when the active prompt belongs to the viewer. */
  isMyTurnPrompt(): boolean;
  /** Cards in the viewer's hand. */
  handCards(): CardSnapshot[];
  pass(): void;
  cancelPrompt(): void;
  /** Returns true if a confirmable action was emitted. */
  confirmPrimary(): boolean;
  playHandCard(card: CardSnapshot): void;
}

/**
 * Pure dispatcher for the match-page keyboard shortcuts. Extracted so
 * it can be unit-tested without mounting MatchPage + its HTTP /
 * SignalR / Auth dependency graph.
 *
 * Bindings:
 *   * Space    → pass (only when an action prompt is active)
 *   * Escape   → cancel prompt
 *   * Enter    → confirm primary action on the prompt overlay
 *   * 1-9      → click Nth hand card (top-row digit, not numpad)
 *
 * Bails silently when the user is typing in an input / textarea /
 * select.
 */
export function dispatchMatchKey(evt: KeyboardEvent, deps: MatchKeyDeps): void {
  const target = evt.target as HTMLElement | null;
  if (target && (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
  )) return;

  const key = evt.key;

  if (key === ' ' || key === 'Spacebar') {
    if (deps.hasActionPrompt()) {
      evt.preventDefault();
      deps.pass();
    }
    return;
  }

  if (key === 'Escape') {
    if (deps.hasPrompt()) {
      evt.preventDefault();
      deps.cancelPrompt();
    }
    return;
  }

  if (key === 'Enter') {
    if (deps.hasPrompt() && deps.isMyTurnPrompt()) {
      if (deps.confirmPrimary()) {
        evt.preventDefault();
      }
    }
    return;
  }

  // Top-row digits 1..9 only — `event.code` distinguishes Numpad from
  // the digit row, both of which surface "1"..."9" on `event.key`.
  if (/^[1-9]$/.test(key) && !evt.code.startsWith('Numpad')) {
    const idx = parseInt(key, 10) - 1;
    const cards = deps.handCards();
    if (idx < cards.length) {
      evt.preventDefault();
      deps.playHandCard(cards[idx]);
    }
    return;
  }
}

// ---------------------------------------------------------------------
// Auto-roll guard.
//
// Decides whether the Rolling-state effect should fire `submitRoll` on
// this signal-tick. Extracted as a pure function so it can be unit-
// tested without standing up MatchPage's full DI graph.
//
// Rules:
//   * No match snapshot yet → never roll.
//   * Match isn't in Rolling state → never roll.
//   * Roll already resolved (winnerSub set) → never roll.
//   * Already submitted in this page lifetime → never roll (the
//     component caller flips `submitted=true` synchronously to dedupe
//     re-entrancy from overlapping signal recomputes).
//
// We intentionally do NOT inspect `auth.principal()` or per-slot fill
// state here. The server is the authority on which seat the caller
// occupies (mapped from JWT `sub`) and `submitRoll` is idempotent for
// an already-filled slot, so any client-side gating just risks
// stalling the flow when Auth0 hasn't emitted claims yet (the bot-
// match "stuck on ROLL FOR FIRST PLAYER" bug). See
// `Majik.Server/Matches/MatchService.SubmitRollAsync`.
// ---------------------------------------------------------------------
export function shouldAutoSubmitRoll(
  m: Match | null,
  submitted: boolean,
): boolean {
  if (!m) return false;
  if (m.state !== 'Rolling') return false;
  if (submitted) return false;
  if (m.roll?.winnerSub) return false;
  return true;
}

// ---------------------------------------------------------------------
// Resilience helpers (Slice 4c). Pure functions so they're unit-testable
// without mounting MatchPage's DI graph.
// ---------------------------------------------------------------------

/**
 * Tolerate PascalCase or camelCase `youPlayerId` from the server (the
 * /state REST endpoint and the SignalR "state" channel both deliver a
 * GameState; the casing depends on System.Text.Json options). The server
 * has stamped youPlayerId since Slice 2a; older builds / spectator views
 * leave it absent → null.
 */
/**
 * Normalise a single AbilityDto wire object to the portal's `Ability` type.
 * Tolerates both PascalCase (`Id`, `Kind`, `Description`) and camelCase
 * (`id`, `kind`, `description`) — mirrors the youPlayerId mapping pattern.
 */
function normaliseAbility(raw: unknown): Ability {
  const a = raw as Record<string, unknown>;
  return {
    kind: String(a['kind'] ?? a['Kind'] ?? ''),
    description: String(a['description'] ?? a['Description'] ?? ''),
    id: (a['id'] ?? a['Id'] ?? null) as string | null,
  };
}

/**
 * Normalise a CardSnapshot wire object, mapping the abilities array (if
 * present) so that each entry has a proper `id` field regardless of
 * server casing.
 */
function normaliseCardSnapshot(raw: unknown): CardSnapshot {
  const c = raw as Record<string, unknown>;
  const abilities = (c['abilities'] ?? c['Abilities']) as unknown[] | undefined;
  const base = raw as CardSnapshot;
  if (!abilities) return base;
  return { ...base, abilities: abilities.map(normaliseAbility) };
}

export function normaliseStateSnapshot(raw: unknown): GameState {
  const r = raw as Record<string, unknown>;
  const base = raw as GameState;
  // Normalise each player's zone card snapshots so ability ids are
  // accessible regardless of server-side JSON casing.
  const players = (base.players ?? []).map(p => ({
    ...p,
    battlefield: {
      cards: (p.battlefield?.cards ?? []).map(normaliseCardSnapshot),
    },
  }));
  return {
    ...base,
    players,
    youPlayerId: (r['youPlayerId'] ?? r['YouPlayerId'] ?? null) as string | null,
  };
}

/**
 * User-facing message for a failed match/state fetch. Network failures
 * read as a connectivity hint; everything else gets a generic "couldn't
 * refresh" so we never leak a raw server code/detail that wasn't meant
 * for users. The Refresh affordance is offered separately by the banner.
 */
export function fetchFailureMessage(error: MatchError): string {
  if (error.code === 'network') {
    return 'Connection problem — couldn’t refresh the board';
  }
  return 'Couldn’t refresh the board — retry';
}

/**
 * User-facing message for a rejected game command (submitCommand) or a
 * rejected concede. Surfaces the engine's rejection reason when the API
 * returns a meaningful one (error.detail), falling back to the error code
 * and finally a generic prefix. Network errors read as connectivity.
 */
export function commandRejectionMessage(error: MatchError, prefix: string): string {
  if (error.code === 'network') {
    return `${prefix} — connection problem`;
  }
  const reason = (error.detail && error.detail.trim()) || humaniseCode(error.code);
  return reason ? `${prefix}: ${reason}` : prefix;
}

function humaniseCode(code: string): string {
  if (!code || code === 'unknown') return '';
  // "cannot-concede" → "cannot concede"
  return code.replace(/-/g, ' ');
}

/**
 * Minimal connection-status indicator view-model. Returns null while the
 * connection is healthy (open / idle) so the header stays clean; a
 * "reconnecting…" warn chip while connecting; and a "connection lost"
 * error chip when the connection errored or automatic reconnect gave up.
 * Session-expiry is handled separately (toast + redirect), so it doesn't
 * also render a chip here.
 */
export function connectionIndicatorFor(
  state: ConnectionState,
  reconnectFailed: boolean,
  sessionExpired: boolean,
): { label: string; tone: 'warn' | 'error' } | null {
  if (sessionExpired) return null; // handled via toast + redirect
  if (reconnectFailed) return { label: 'Connection lost', tone: 'error' };
  switch (state) {
    case 'connecting':
      return { label: 'Reconnecting…', tone: 'warn' };
    case 'error':
      return { label: 'Connection lost', tone: 'error' };
    case 'closed':
      return { label: 'Disconnected', tone: 'warn' };
    default:
      return null; // open / idle
  }
}

