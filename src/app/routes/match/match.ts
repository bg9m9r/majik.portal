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
import { PromptOverlayComponent, PromptDecision } from './components/prompt-overlay.component';
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
    PromptOverlayComponent,
  ],
  template: `
    <main class="flex min-h-screen flex-col">
      <header class="flex items-center justify-between border-b border-[color:var(--majik-line)] p-3">
        <h1 class="majik-h2">Match <code class="majik-code">{{ id }}</code></h1>
        <div class="flex items-center gap-3 text-xs">
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
                (passClicked)="onPass()"
                (handCardClicked)="onHandClicked($event)" />
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
  }

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.botThinking.set(false);
    this.game.reset();
    void this.signalr.disconnect();
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
