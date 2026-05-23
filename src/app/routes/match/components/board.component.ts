import { Component, computed, input, output } from '@angular/core';
import { GameState, GamePlayer, CardSnapshot } from '../../../core/match/match.types';
import { CardViewComponent } from '../../../ui/card-view.component';
import { PlayerHudComponent } from '../../../ui/player-hud.component';
import { PhaseBarComponent } from '../../../ui/phase-bar.component';
import { ActionBarComponent } from './action-bar.component';

@Component({
  selector: 'app-board',
  standalone: true,
  imports: [CardViewComponent, PlayerHudComponent, PhaseBarComponent, ActionBarComponent],
  template: `
    @if (state(); as s) {
      <div class="flex flex-1 flex-col">
        <app-phase-bar [phase]="s.phase" [turn]="s.turnNumber" />

        <div class="flex flex-1 flex-col gap-2 p-3">
          <app-player-hud
            [player]="opponent()"
            [active]="opponent()?.id === s.activePlayerId"
            label="opponent" />

          <section class="battlefield flex-1">
            <div class="battlefield-row border border-white/5 bg-black/20">
              @for (c of opponent()?.battlefield?.cards ?? []; track c.instanceId) {
                <app-card-view [snapshot]="c" />
              } @empty {
                <span class="opacity-30">— opponent battlefield empty —</span>
              }
            </div>
            <div class="battlefield-row border border-white/10 bg-black/30">
              @for (c of self()?.battlefield?.cards ?? []; track c.instanceId) {
                <app-card-view [snapshot]="c" />
              } @empty {
                <span class="opacity-30">— your battlefield empty —</span>
              }
            </div>
          </section>

          <section class="grid grid-cols-[1fr_240px] gap-2">
            <div class="hand-row" role="list" aria-label="your hand">
              @for (c of self()?.hand?.cards ?? []; track c.instanceId) {
                <button
                  type="button"
                  role="listitem"
                  class="bg-transparent p-0 focus:outline focus:outline-2 focus:outline-amber-400"
                  [attr.aria-label]="'play ' + c.name"
                  (click)="handCardClicked.emit(c)"
                  (keydown.enter)="handCardClicked.emit(c)">
                  <app-card-view [snapshot]="c" />
                </button>
              } @empty {
                <span class="opacity-30">— hand empty —</span>
              }
            </div>
            <aside class="rounded border border-white/10 p-2">
              <h3 class="mb-1 text-[10px] uppercase tracking-wider opacity-60">Stack ({{ s.stack.length }})</h3>
              @for (item of s.stack; track item.id) {
                <div class="stack-item border-b border-white/5 py-1 text-xs">
                  <div class="font-semibold">{{ item.kind }}</div>
                  <div class="opacity-70">{{ item.description }}</div>
                </div>
              } @empty {
                <p class="text-xs opacity-40">empty</p>
              }
            </aside>
          </section>

          <div class="text-[10px] opacity-50">
            Opp hand: {{ opponent()?.hand?.cards?.length ?? 0 }}
            (placeholder rendering — opp hand returns hidden cards via per-viewer mask)
          </div>

          <app-player-hud
            [player]="self()"
            [active]="self()?.id === s.activePlayerId"
            label="you" />
        </div>

        <app-action-bar
          [canPass]="!!currentPrompt()"
          [currentPrompt]="currentPrompt()"
          (pass)="passClicked.emit()" />
      </div>
    } @else {
      <p class="p-4 opacity-60">No game state.</p>
    }
  `
})
export class BoardComponent {
  readonly state = input<GameState | null>(null);
  readonly selfPlayerIds = input<string[]>([]);
  readonly currentPrompt = input<{ expectedKinds?: string[]; description?: string } | null>(null);
  readonly passClicked = output<void>();
  readonly handCardClicked = output<CardSnapshot>();

  readonly self = computed<GamePlayer | null>(() => {
    const s = this.state();
    if (!s) return null;
    const owned = this.selfPlayerIds();
    return s.players.find(p => owned.includes(p.id)) ?? s.players[0] ?? null;
  });

  readonly opponent = computed<GamePlayer | null>(() => {
    const s = this.state();
    if (!s) return null;
    const me = this.self();
    return s.players.find(p => p.id !== me?.id) ?? null;
  });

  readonly opponentHidden = computed<CardSnapshot[]>(() => {
    const opp = this.opponent();
    return opp?.hand.cards ?? [];
  });
}
