import { Component, computed, input, output, signal } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { GameState, GamePlayer, CardSnapshot } from '../../../core/match/match.types';
import { PhaseStops } from '../../../core/match/game.store';
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
  // Layout overview (PR #33):
  //
  //   ┌─────────────────────────────────────────────────────────────────┐
  //   │ phase-bar                                                       │
  //   ├──────────────────┬────────────┬──────────────────────────────────┤
  //   │ player-frame     │ stack-spine│ player-frame                    │
  //   │  --foe           │  (200px)   │  --self                         │
  //   │   HUD            │   newest   │   battlefield-row (self)        │
  //   │   hand-row (opp) │     ↓      │   hand-row (self, drag-drop)    │
  //   │   battlefield    │   oldest   │   HUD                           │
  //   ├──────────────────┴────────────┴──────────────────────────────────┤
  //   │ action-bar                                                      │
  //   └─────────────────────────────────────────────────────────────────┘
  //
  // Each player-frame is the DOM unit that means "this is one player's
  // half of the table". The whose-turn ambient rim moves onto the frame
  // container (was previously split across the battlefield row + HUD).
  // A single inactive-side dim sells "active reads brighter" without
  // changing the absolute colours.
  //
  // The self-frame stacks battlefield ABOVE hand ABOVE HUD so the user's
  // hand sits closest to the bottom-of-screen action bar (table layout
  // convention). The opponent-frame mirrors this: HUD ABOVE hand ABOVE
  // battlefield.
  //
  // Zone transitions: card-view nodes track by instanceId, so as the
  // reducer patches state in place (event.reducer.ts), Angular's
  // animate.enter / animate.leave directives fire when a card appears in
  // or disappears from a zone. Keyframes live in board.scss — leave =
  // fade + slight downshift, enter = fade up. Stack-item leave uses the
  // same primitive so resolution finally has a visual.
  template: `
    @if (state(); as s) {
      <div class="flex flex-1 flex-col">
        <app-phase-bar
          [phase]="s.phase"
          [turn]="s.turnNumber"
          [stops]="phaseStops()"
          (stopToggled)="phaseStopToggled.emit($event)" />

        <div class="board-grid grid grid-cols-[1fr_200px_1fr] gap-2 p-3 flex-1">
          <!-- Opponent frame: HUD on top, hand below, battlefield at the bottom. -->
          <section
            class="player-frame player-frame--foe"
            [class.player-frame--active-foe]="opponent()?.id === s.activePlayerId"
            [class.player-frame--inactive]="opponent()?.id !== s.activePlayerId">
            <app-player-hud
              [player]="opponent()"
              [active]="opponent()?.id === s.activePlayerId"
              side="opponent"
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
                <app-card-view
                  role="listitem"
                  [snapshot]="c"
                  [hidden]="true"
                  animate.enter="zone-enter-from-top"
                  animate.leave="zone-leave-up" />
              } @empty {
                <span class="opacity-30">— opponent hand empty —</span>
              }
            </div>

            <div class="battlefield-row">
              @for (c of opponent()?.battlefield?.cards ?? []; track c.instanceId) {
                <app-card-view
                  [snapshot]="c"
                  zone="battlefield"
                  animate.enter="zone-enter-from-top"
                  animate.leave="zone-leave-down" />
              } @empty {
                <span class="opacity-30">— opponent battlefield empty —</span>
              }
            </div>
          </section>

          <!--
            Center stack spine. Vertical column between the two player
            frames; newest stack object at the top so resolution reads
            top → bottom. Reuses the existing .stack-item rim styling
            from board.scss; only the layout container changes.
          -->
          <aside
            class="stack-spine"
            [class.stack-spine--populated]="s.stack.length > 0"
            aria-label="stack">
            <h3 class="mb-1 text-[10px] uppercase tracking-wider opacity-60">
              Stack ({{ s.stack.length }})
            </h3>
            @for (item of reversedStack(); track item.id; let i = $index) {
              <div
                class="stack-item py-1 text-xs"
                [class.stack-item--top]="i === 0"
                animate.enter="stack-item-enter"
                animate.leave="stack-item-leave">
                <div class="font-semibold">{{ item.kind }}</div>
                <div class="opacity-70">{{ item.description }}</div>
              </div>
            } @empty {
              <p class="text-xs opacity-40">empty</p>
            }
          </aside>

          <!-- Self frame: battlefield on top, hand below, HUD at the bottom. -->
          <section
            class="player-frame player-frame--self"
            [class.player-frame--active-self]="self()?.id === s.activePlayerId"
            [class.player-frame--inactive]="self()?.id !== s.activePlayerId">
            <div class="battlefield-row">
              @for (c of self()?.battlefield?.cards ?? []; track c.instanceId) {
                <app-card-view
                  [snapshot]="c"
                  zone="battlefield"
                  animate.enter="zone-enter-from-bottom"
                  animate.leave="zone-leave-up" />
              } @empty {
                <span class="opacity-30">— your battlefield empty —</span>
              }
            </div>

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
                  (keydown.enter)="handCardClicked.emit(c)"
                  animate.enter="zone-enter-from-top"
                  animate.leave="zone-leave-down">
                  <app-card-view [snapshot]="c" />
                  <div *cdkDragPlaceholder class="hand-card-placeholder"></div>
                </button>
              } @empty {
                <span class="opacity-30">— hand empty —</span>
              }
            </div>

            <app-player-hud
              [player]="self()"
              [active]="self()?.id === s.activePlayerId"
              side="self"
              label="you" />
          </section>
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
  readonly phaseStops = input<PhaseStops>({});
  readonly passClicked = output<void>();
  readonly handCardClicked = output<CardSnapshot>();
  readonly phaseStopToggled = output<string>();

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

  // Stack-spine renders newest at the top. The wire-level stack array
  // grows tail-newest (StackObjectAddedEvent appends in event.reducer),
  // so a reversed projection is what the user actually wants to see.
  // The top-of-stack highlight follows: i === 0 instead of length - 1.
  readonly reversedStack = computed(() => {
    const s = this.state();
    if (!s) return [];
    return s.stack.slice().reverse();
  });

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
