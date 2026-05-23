import { Component, DestroyRef, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
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
import { PromptOverlayComponent, PromptDecision, detectKind } from './components/prompt-overlay.component';
import {
  CardSnapshot, GameCommand, Match, PromptEnvelope
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
                (passClicked)="onPass()"
                (handCardClicked)="onHandClicked($event)"
                (phaseStopToggled)="game.togglePhaseStop($event)"
                (concedeClicked)="onConcede()"
                (undoClicked)="onUndoRequested()" />
              @if (game.prompt(); as p) {
                @if (game.isMyTurnPrompt()) {
                  <app-prompt-overlay
                    [state]="game.state()"
                    [prompt]="p"
                    [selfPlayerIds]="game.selfPlayerIds()"
                    (decision)="onPromptDecision($event)"
                    (cancel)="onPromptCancel()" />
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

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly loadError = signal<string | null>(null);
  readonly current = this.matchSvc.current;
  readonly botThinking = signal(false);

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
    effect(() => {
      const m = this.matchSvc.current();
      if (!m || m.state !== 'Rolling' || this.rollSubmitted) return;
      const sub = this.auth.principal()?.sub;
      if (!sub) return;
      const isCreator = sub === m.creator.sub;
      const slotFilled = isCreator ? m.roll?.creatorRoll != null : m.roll?.opponentRoll != null;
      if (slotFilled) return;
      this.rollSubmitted = true;
      void this.matchSvc.submitRoll(m.id).then(r => {
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
      if (!this.shouldAutoPass(p)) return;
      this.lastAutoPassedPrompt = p;
      void this.send({ $type: 'pass' });
    });
  }

  // Identity-tracks the envelope we already auto-passed for. SignalR
  // emits a fresh envelope object per prompt, so reference equality is
  // sufficient — no need to derive a composite key.
  private lastAutoPassedPrompt: PromptEnvelope | null = null;

  // Phases that should never auto-pass on the viewer's own turn — the
  // user almost always wants to act in their main phases.
  private static readonly MY_TURN_NO_PASS_PHASES = new Set([
    'PreCombatMain',
    'PostCombatMain',
  ]);

  // Combat phases on the opponent's turn — auto-pass is suppressed if
  // the viewer has any non-land card in hand so they don't unknowingly
  // skip an instant-speed response window into / through combat.
  private static readonly THEIR_TURN_COMBAT_PHASES = new Set([
    'BeginningOfCombat',
    'DeclareAttackers',
    'DeclareBlockers',
    'CombatDamage',
    'EndOfCombat',
  ]);

  private shouldAutoPass(p: PromptEnvelope): boolean {
    // Only priority-pass prompts auto-resolve. Targets / attackers /
    // blockers / mulligan / X / mode / bottom all need user input.
    if (detectKind(p.expectedKinds) !== 'none') return false;
    const s = this.game.state();
    if (!s) return false;
    // Anything on the stack — never auto-pass. Preserves the response
    // window per CR 117.3b.
    if (s.stack.length > 0) return false;
    const phase = s.phase;
    const selfIds = this.game.selfPlayerIds();
    const activeSide: 'mine' | 'theirs' =
      selfIds.includes(s.activePlayerId) ? 'mine' : 'theirs';
    // Phase-stop set for this side wins — user explicitly asked to
    // pause here.
    const stop = this.game.phaseStops()[phase];
    if (stop === activeSide) return false;
    // Main phases on the viewer's turn — user almost certainly wants to
    // cast/play, so we never silently skip past them.
    if (activeSide === 'mine' && MatchPage.MY_TURN_NO_PASS_PHASES.has(phase)) {
      return false;
    }
    // Opponent's combat phases — only auto-pass if the viewer has
    // nothing castable. Approximation: any non-land card in hand. Mana
    // isn't checked client-side, so this is conservative on purpose.
    if (activeSide === 'theirs' && MatchPage.THEIR_TURN_COMBAT_PHASES.has(phase)) {
      const me = s.players.find(pl => selfIds.includes(pl.id));
      const hasNonLand = (me?.hand.cards ?? []).some(c =>
        !(c.types ?? []).map(t => t.toLowerCase()).includes('land'));
      if (hasNonLand) return false;
    }
    return true;
  }

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
      .subscribe(d => this.game.pushBotDecision(d));
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
        const envelope: PromptEnvelope = {
          gameId: String(raw['gameId'] ?? raw['GameId'] ?? ''),
          playerId: String(raw['playerId'] ?? raw['PlayerId'] ?? ''),
          expectedKinds: (raw['expectedKinds'] ?? raw['ExpectedKinds'] ?? []) as string[],
          description: (raw['description'] ?? raw['Description']) as string | undefined,
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
    await this.send(cmd);
  }

  onPromptCancel(): void {
    // No server-side cancel today — clearing locally lets the user
    // dismiss a prompt overlay; the engine will resend on its next tick
    // if it's still waiting.
    this.game.clearPrompt();
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

// MM:SS string for header chip — caps at 99:59 because anything beyond
// that means the server hasn't started counting yet and the leading
// digits would shove other header content offscreen.
function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.min(99, Math.floor(totalSec / 60));
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

