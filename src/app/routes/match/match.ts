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
import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from '../../core/profile/profile.service';
import { GameStore } from '../../core/match/game.store';
import { WaitingStateComponent } from './components/waiting-state.component';
import { RollingStateComponent } from './components/rolling-state.component';
import { PlayDrawPromptComponent } from './components/play-draw-prompt.component';
import { CompletedStateComponent } from './components/completed-state.component';
import { BoardComponent } from './components/board.component';
import { BotDecisionsPanelComponent } from './components/bot-decisions-panel.component';
import { PromptOverlayComponent, PromptDecision } from './components/prompt-overlay.component';
import { ToastService } from '../../ui/toast.service';
import {
  BotDecision, CardSnapshot, GameCommand, GameState, Match, PromptEnvelope
} from '../../core/match/match.types';

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
          @if (myTimerState(); as t) {
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
          @if (fullControl()) {
            <span
              class="full-control-chip"
              role="status"
              aria-label="full control active — auto-pass priority is suppressed">
              ⌃ FULL CONTROL
            </span>
          }
          @if (opponentTimerState(); as t) {
            <span
              class="match-timer"
              [class.match-timer--active]="t.active"
              [class.match-timer--low]="t.low"
              [attr.aria-label]="'opponent clock: ' + t.text">
              <span class="match-timer__label">OPP</span>
              <span>{{ t.text }}</span>
            </span>
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
                (activateManaRequested)="onActivateManaRequested($event)" />
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
  private readonly matchSvc = inject(MatchService);
  private readonly signalr = inject(SignalrService);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);
  readonly profile = inject(ProfileService);
  readonly game = inject(GameStore);
  private readonly toast = inject(ToastService);

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly loadError = signal<string | null>(null);
  readonly current = this.matchSvc.current;
  readonly botThinking = signal(false);

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

  // Local 1Hz heartbeat for the header timer chips. Server's
  // clockUpdate$ resyncs the canonical countdown; this just smooths the
  // display between syncs so it doesn't appear to freeze for a second.
  // Stamped on every push of a fresh match snapshot so the local tick
  // computes deltas off the most recently-confirmed clock value.
  private readonly clockAnchor = signal<{
    creatorMs: number;
    opponentMs: number;
    holderSub: string | null;
    at: number;
  } | null>(null);
  private readonly nowMs = signal<number>(Date.now());

  // Full Control mode — press-once toggle on the Ctrl / Meta key.
  // While true the auto-pass effect short-circuits so the viewer
  // keeps priority on every step, even after casting (mirrors MTGO's
  // "Full Control" toggle). Press Ctrl again to release. The
  // template binds an indicator chip off this signal too.
  readonly fullControl = signal<boolean>(false);
  private clockTickHandle: ReturnType<typeof setInterval> | null = null;

  // Timer chip view-model. `active` flips on for the player who
  // currently holds priority (their clock is the one being burned).
  // `low` triggers the pulsing err style at ≤30s.
  readonly myTimerState = computed<{ text: string; active: boolean; low: boolean } | null>(() =>
    this.timerStateFor('self'));
  readonly opponentTimerState = computed<{ text: string; active: boolean; low: boolean } | null>(() =>
    this.timerStateFor('opponent'));

  // Debounce overlapping re-fetches: every engine event currently
  // triggers a full /state pull. If two land in the same tick we don't
  // need two parallel GETs — a second flight just races. Coalesce by
  // marking a single pending request.
  private statePending = false;

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
    // Re-anchor the local clock whenever the canonical Match snapshot
    // changes. The server pushes a fresh Match on each clock-update SignalR
    // event (see refresh() in load()), so anchoring off matchSvc.current
    // means we automatically resync every time the server speaks.
    effect(() => {
      const m = this.matchSvc.current();
      if (!m) {
        this.clockAnchor.set(null);
        return;
      }
      this.clockAnchor.set({
        creatorMs: m.creatorMillisRemaining,
        opponentMs: m.opponentMillisRemaining,
        holderSub: m.priorityHolderSub,
        at: Date.now(),
      });
    });
    effect(() => {
      const m = this.matchSvc.current();
      if (m && (m.state === 'Completed' || m.state === 'Abandoned')) {
        this.botThinking.set(false);
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
    // Auto-pass priority unless one of the guards trips. The signal
    // graph fires this whenever a new prompt envelope lands; the
    // `lastAutoPassedPrompt` identity check dedupes against re-runs
    // triggered by unrelated state mutations on the same envelope.
    effect(() => {
      const p = this.game.prompt();
      if (!p || !this.game.isMyTurnPrompt()) return;
      if (p === this.lastAutoPassedPrompt) return;
      const decision = shouldAutoPass(p, {
        state: this.game.state(),
        selfPlayerIds: this.game.selfPlayerIds(),
        phaseStops: this.game.phaseStops(),
        fullControl: this.fullControl(),
      });
      if (!decision) return;
      this.lastAutoPassedPrompt = p;
      void this.send({ $type: 'pass' });
    });
  }

  // Identity-tracks the envelope we already auto-passed for. SignalR
  // emits a fresh envelope object per prompt, so reference equality is
  // sufficient — no need to derive a composite key.
  private lastAutoPassedPrompt: PromptEnvelope | null = null;

  ngOnInit(): void {
    void this.load();
    // 1Hz local tick for header timer chips. Stops on destroy. Uses
    // setInterval — a single 1s cadence is plenty for MM:SS display
    // and keeps things off the rAF hot path.
    this.clockTickHandle = setInterval(() => this.nowMs.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    this.botThinking.set(false);
    this.game.reset();
    void this.signalr.disconnect();
    if (this.clockTickHandle) {
      clearInterval(this.clockTickHandle);
      this.clockTickHandle = null;
    }
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
  }

  private async refresh(): Promise<void> {
    const r = await this.matchSvc.get(this.id);
    if (r.ok) this.matchSvc.setCurrent(r.value);
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
          this.game.setState(r.value);
          this.resolveSelfPlayerIds();
        }
      } while (this.stateDirty);
    } finally {
      this.statePending = false;
    }
  }

  // Engine PlayerDto.Id is the random seat id, but MatchDto carries the
  // human/bot Handle. Engine snapshots use that Handle as PlayerDto.Name
  // (see GameFacade/Player init), so the safe mapping is by handle.
  private resolveSelfPlayerIds(): void {
    const state = this.game.state();
    const m = this.matchSvc.current();
    const sub = this.auth.principal()?.sub;
    if (!state || !m || !sub) {
      this.game.setSelfPlayerIds([]);
      return;
    }
    const myHandle = sub === m.creator.sub
      ? m.creator.handle
      : m.opponent?.sub === sub ? m.opponent.handle : null;
    if (!myHandle) {
      this.game.setSelfPlayerIds([]);
      return;
    }
    const ids = state.players.filter(p => p.name === myHandle).map(p => p.id);
    this.game.setSelfPlayerIds(ids);
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
    if (!r.ok) console.warn('concede failed', r.error);
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

  /** View-model builder for the header timer chips. */
  private timerStateFor(side: 'self' | 'opponent'): { text: string; active: boolean; low: boolean } | null {
    const m = this.matchSvc.current();
    const anchor = this.clockAnchor();
    const mySub = this.auth.principal()?.sub;
    if (!m || !anchor || !mySub) return null;
    // Resolve which seat we're displaying. Creator/opponent in the
    // MatchDto map directly onto the two clock fields.
    const iAmCreator = mySub === m.creator.sub;
    const targetIsCreator = side === 'self' ? iAmCreator : !iAmCreator;
    const baseMs = targetIsCreator ? anchor.creatorMs : anchor.opponentMs;
    const targetSub = targetIsCreator ? m.creator.sub : m.opponent?.sub ?? null;
    if (targetSub == null) return null;
    // Burn local time off whoever currently holds priority. The server
    // resyncs this on every clock-update event so any drift caps at
    // the next event boundary.
    const holdsPriority = anchor.holderSub != null && anchor.holderSub === targetSub;
    const elapsedSinceAnchor = holdsPriority ? this.nowMs() - anchor.at : 0;
    const remaining = Math.max(0, baseMs - elapsedSinceAnchor);
    return {
      text: formatMmSs(remaining),
      active: holdsPriority,
      low: remaining <= 30_000,
    };
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
      this.fullControl.update(v => !v);
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
      // The toast service would be the right home for this, but the
      // user-visible error path for engine-rejects is unspecified.
      // Log instead so we don't swallow silently.
      console.warn('submitCommand failed', cmd, r.error);
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
// Auto-pass guard.
//
// Decides whether an arriving "pass priority" prompt should be answered
// silently with a Pass command, or surfaced to the user for them to
// decide. Extracted as a pure function so it can be unit-tested in
// isolation from the MatchPage component graph.
//
// Full Control (highest-priority guard): user is holding Ctrl. Suppress
// auto-pass for every step, mirroring MTGO's Full Control toggle.
//
// Primary gate (CR 117.3a — priority is the player's right to act):
//   Auto-pass ONLY when the engine signals that PassPriority is the
//   sole legal action — i.e. expectedKinds is exactly
//   `['PassPriorityCommand']`. Any time the engine surfaces additional
//   command kinds (PlayLand, CastSpell, ActivateAbility, …) the viewer
//   has a real choice and must see the prompt. This subsumes the prior
//   land-in-hand / stack-non-empty heuristics: if the user can play a
//   land or cast a spell, the engine includes those kinds and the gate
//   trips before any of the secondary guards run. The secondary guards
//   remain as defence-in-depth for the day the engine narrows kinds.
//
// Defence-in-depth (only consulted once primary gate has matched a
// pass-only round):
//
//   - No GameState snapshot yet → never auto-pass.
//   - selfPlayerIds is empty (race: prompt arrived before /state
//     populated the viewer's seat) → never auto-pass.
//   - Stack non-empty → never auto-pass (CR 117.3b response window).
//   - Phase-stop registered for the active turn's side → never
//     auto-pass (the user explicitly asked to pause here).
//   - Opponent's combat phase AND the viewer has a non-land in hand
//     → never auto-pass (instant-speed response window). Mana isn't
//     checked client-side, so this is intentionally conservative.
// ---------------------------------------------------------------------

export interface AutoPassDeps {
  state: GameState | null;
  selfPlayerIds: readonly string[];
  phaseStops: Record<string, 'mine' | 'theirs'>;
  // When true (user holding Ctrl), auto-pass is suppressed for every
  // step — even after casting a spell, even on phases that would
  // otherwise be safe to skip. Mirrors MTGO's "Full Control" toggle.
  fullControl: boolean;
}

// Combat phases on the opponent's turn — auto-pass is suppressed if
// the viewer has any non-land card in hand so they don't unknowingly
// skip an instant-speed response window into / through combat.
const OPP_COMBAT_PHASES = new Set([
  'BeginningOfCombat',
  'DeclareAttackers',
  'DeclareBlockers',
  'CombatDamage',
  'EndOfCombat',
]);

/**
 * Primary gate — does the engine signal "PassPriority is your only
 * legal action"? Today `Majik.Core.Api/RemoteAgent.cs#ChoosePriorityActionAsync`
 * always sends the full set `[PassPriorityCommand, PlayLandCommand,
 * CastSpellCommand]` regardless of legality, so this gate only matches
 * once the engine starts narrowing. Until then auto-pass is effectively
 * disabled for priority rounds, which is the safe direction — the user
 * sees the prompt and explicitly passes.
 */
function isPassOnlyPriorityPrompt(kinds: readonly string[] | undefined): boolean {
  if (!kinds || kinds.length !== 1) return false;
  return kinds[0] === 'PassPriorityCommand';
}

export function shouldAutoPass(p: PromptEnvelope, deps: AutoPassDeps): boolean {
  // (0) — Full Control: user is holding Ctrl. Suppress auto-pass for
  // every step, including the priority pass that normally follows a
  // spell resolution. Highest-priority guard so it wins over any
  // other rule.
  if (deps.fullControl) return false;
  // (1) primary gate — only auto-pass when PassPriority is the engine's
  // single offered action. Multi-kind prompts (`[PassPriorityCommand,
  // PlayLandCommand, …]`) mean the viewer has choices to make.
  if (!isPassOnlyPriorityPrompt(p.expectedKinds)) return false;
  // (2) — no snapshot yet.
  const s = deps.state;
  if (!s) return false;
  // (3) — empty selfPlayerIds (race: prompt before /state). Without
  // knowing which seat is the viewer's, we can't classify the active
  // side for the remaining defence-in-depth checks — bias toward
  // surfacing the prompt.
  if (deps.selfPlayerIds.length === 0) return false;
  // (4) — stack non-empty (CR 117.3b response window).
  if (s.stack.length > 0) return false;
  const phase = s.phase;
  const selfIds = deps.selfPlayerIds;
  const activeSide: 'mine' | 'theirs' =
    selfIds.includes(s.activePlayerId) ? 'mine' : 'theirs';
  // (5) — phase stop set for the active side.
  const stop = deps.phaseStops[phase];
  if (stop === activeSide) return false;
  // (6) — opponent's combat phase + the viewer has a non-land in hand.
  if (activeSide === 'theirs' && OPP_COMBAT_PHASES.has(phase)) {
    const me = s.players.find(pl => selfIds.includes(pl.id));
    const hasNonLand = (me?.hand.cards ?? []).some(c =>
      !(c.types ?? []).map(t => t.toLowerCase()).includes('land'));
    if (hasNonLand) return false;
  }
  return true;
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

// MM:SS string for header chip — caps at 99:59 because anything beyond
// that means the server hasn't started counting yet and the leading
// digits would shove other header content offscreen.
function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.min(99, Math.floor(totalSec / 60));
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

