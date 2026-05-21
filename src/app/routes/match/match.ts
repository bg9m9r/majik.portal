import { Component, DestroyRef, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatchService } from '../../core/match/match.service';
import { SignalrService } from '../../core/signalr/signalr.service';
import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from '../../core/profile/profile.service';
import { WaitingStateComponent } from './components/waiting-state.component';
import { RollingStateComponent } from './components/rolling-state.component';
import { PlayDrawPromptComponent } from './components/play-draw-prompt.component';
import { CompletedStateComponent } from './components/completed-state.component';
import { BoardComponent } from './components/board.component';
import { Match } from '../../core/match/match.types';

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
            @case ('Playing')   { <app-board [state]="null" [selfPlayerIds]="[]" [currentPrompt]="null" /> }
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

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly loadError = signal<string | null>(null);
  readonly current = this.matchSvc.current;
  readonly botThinking = signal(false);

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
  }

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.botThinking.set(false);
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
  }

  private async refresh(): Promise<void> {
    const r = await this.matchSvc.get(this.id);
    if (r.ok) this.matchSvc.setCurrent(r.value);
  }

  isRollWinner(m: Match): boolean {
    return m.roll?.winnerSub === this.auth.principal()?.sub;
  }

  async onPlayDraw(choice: 'play' | 'draw'): Promise<void> {
    await this.matchSvc.playDraw(this.id, { choice });
  }
}
