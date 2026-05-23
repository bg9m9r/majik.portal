import { Component, computed, input, output, signal } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { GameState, GamePlayer, CardSnapshot } from '../../../core/match/match.types';
import { CardViewComponent } from '../../../ui/card-view.component';
import { PlayerHudComponent } from '../../../ui/player-hud.component';
import { PhaseBarComponent } from '../../../ui/phase-bar.component';
import { ActionBarComponent } from './action-bar.component';

@Component({
  selector: 'app-board',
  standalone: true,
  imports: [
    CardViewComponent,
    PlayerHudComponent,
    PhaseBarComponent,
    ActionBarComponent,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
  ],
  template: `
    @if (state(); as s) {
      <div class="flex flex-1 flex-col">
        <app-phase-bar [phase]="s.phase" [turn]="s.turnNumber" />

        <div class="flex flex-1 flex-col gap-2 p-3">
          <app-player-hud
            [player]="opponent()"
            [active]="opponent()?.id === s.activePlayerId"
            label="opponent" />

          <!--
            Opponent hand (face-down). Server emits the opponent's hand
            as N "(hidden)" placeholder cards via the per-viewer mask in
            StateSnapshotter (CR 706) — we render one face-down card per
            placeholder so the count is visually obvious without leaking
            names. Cards are non-interactive — they're opponent property.
          -->
          <div class="hand-row hand-row--opponent" role="list"
               [attr.aria-label]="'opponent hand, ' + opponentHandCount() + ' cards'">
            @for (c of opponent()?.hand?.cards ?? []; track $index) {
              <app-card-view role="listitem" [snapshot]="c" [hidden]="true" />
            } @empty {
              <span class="opacity-30">— opponent hand empty —</span>
            }
          </div>

          <section class="battlefield">
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

          <div class="flex-1"></div>

          <section class="grid grid-cols-[1fr_240px] gap-2">
            <div
              class="hand-row"
              role="list"
              aria-label="your hand"
              cdkDropList
              cdkDropListOrientation="horizontal"
              (cdkDropListDropped)="onHandDrop($event)">
              @for (c of orderedSelfHand(); track c.instanceId) {
                <button
                  type="button"
                  role="listitem"
                  class="bg-transparent p-0 focus:outline focus:outline-2 focus:outline-amber-400"
                  cdkDrag
                  [cdkDragData]="c"
                  [attr.aria-label]="'play ' + c.name"
                  (click)="handCardClicked.emit(c)"
                  (keydown.enter)="handCardClicked.emit(c)">
                  <app-card-view [snapshot]="c" />
                  <div *cdkDragPlaceholder class="hand-card-placeholder"></div>
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

  // Card count of the opponent's hand for the aria label. Reads the
  // same mask-emitted placeholder list — length equals the engine's
  // real hand size (StateSnapshotter.HiddenZone preserves count).
  readonly opponentHandCount = computed<number>(() => this.opponentHidden().length);

  // Client-only ordering for the local player's hand — server emits
  // hand cards in draw order, drag-drop just rearranges the projection.
  // Persisted as an instanceId list so cards leaving the hand (cast,
  // discarded) prune themselves and freshly-drawn cards land at the
  // end without resetting the user's chosen order.
  private readonly handOrder = signal<string[]>([]);

  readonly orderedSelfHand = computed<CardSnapshot[]>(() => {
    const cards = this.self()?.hand.cards ?? [];
    const byId = new Map(cards.map(c => [c.instanceId, c]));
    const seen = new Set<string>();
    const ordered: CardSnapshot[] = [];
    for (const id of this.handOrder()) {
      const card = byId.get(id);
      if (card) { ordered.push(card); seen.add(id); }
    }
    for (const card of cards) {
      if (!seen.has(card.instanceId)) ordered.push(card);
    }
    return ordered;
  });

  onHandDrop(event: CdkDragDrop<CardSnapshot[]>): void {
    const next = this.orderedSelfHand().slice();
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.handOrder.set(next.map(c => c.instanceId));
  }
}
