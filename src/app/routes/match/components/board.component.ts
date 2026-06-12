import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { GameState, GamePlayer, CardSnapshot } from '../../../core/match/match.types';
import { GameStore, PhaseStops } from '../../../core/match/game.store';
import { isPriorityPrompt } from '../../../core/match/match-session';
import { CardViewComponent, snapshotToCard } from '../../../ui/card-view.component';
import { PlayerHudComponent } from '../../../ui/player-hud.component';
import { ManaPoolRowComponent } from '../../../ui/mana-pool-row.component';
import { PhaseBarComponent } from '../../../ui/phase-bar.component';
import { ActionBarComponent } from './action-bar.component';
import {
  ActivatableAbility,
  CardContextMenuAction,
  CardContextMenuComponent,
} from '../../../ui/card-context-menu.component';
import { CardPopoverService } from '../../../ui/card-popover.service';
import { ManaColorPickerComponent } from '../../../ui/mana-color-picker.component';
import { bucketBattlefield, BattlefieldBuckets } from './bucket-battlefield';
import { GraveyardPileComponent } from './graveyard-pile.component';
import { GraveyardModalComponent } from './graveyard-modal.component';

@Component({
  selector: 'app-board',
  standalone: true,
  imports: [
    CardViewComponent,
    PlayerHudComponent,
    ManaPoolRowComponent,
    PhaseBarComponent,
    ActionBarComponent,
    CardContextMenuComponent,
    ManaColorPickerComponent,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    GraveyardPileComponent,
    GraveyardModalComponent,
  ],
  // ----------------------------------------------------------------
  // Host display.
  //
  // The board's inner layout (`.board-arena.flex-1` claiming the
  // middle band, `.arena-side { flex: 1 1 0; min-height: 0 }` divvying
  // that band in half) relies on a CONSTRAINED height propagating down
  // from `<main class="min-h-screen">` → `<section class="flex-1">` →
  // `<app-board>` → inner column-flex. Angular host elements default
  // to `display: inline`, which breaks that chain — the section's
  // `flex-1` doesn't apply to inline children, so the board's inner
  // `flex-1` div is content-sized, every `.arena-side { flex: 1 1 0 }`
  // collapses to 0, and the inner HUD / hand / battlefield content
  // overflows on top of each other (regression vs. the pre-zoned
  // layout where each row had a fixed pixel height and didn't need
  // height-propagation to render).
  //
  // Promoting the host to `display: flex; flex: 1; min-height: 0;
  // flex-direction: column` makes the host fill its section parent
  // AND constrain its children so `.arena-side flex: 1 1 0` actually
  // resolves to "half of the available board area". Locked in a spec
  // (board.component.spec.ts → "host fills its parent" + DOM-order
  // assertions on the self side).
  // ----------------------------------------------------------------
  // Symmetric non-battlefield footprint across the two sides.
  //
  // Each .arena-side is flex: 1 1 0 (equal half each), but the
  // inner stack ABOVE the centerline used to be asymmetric: the
  // opp side parks HUD + mana + face-down hand in a single
  // .arena-strip (with the face-down hand shrunk to 56×78 via the
  // .arena-strip__hand override in board.scss), so opp non-bf
  // height ≈ one shrunk-card row. The self side stacks
  // (full-size .hand-row) + (.arena-strip--self HUD/mana row),
  // which is much taller. Net: opp .battlefield got more vertical
  // space than self .battlefield — the self board looked clipped.
  //
  // Fix: lock the THREE non-battlefield elements (opp strip; self
  // hand-row; self strip-self) to fixed heights such that
  //
  //   opp .arena-strip height
  //     == self .hand-row height + self .arena-strip--self height
  //
  // Both .battlefield wrappers are flex: 1 1 0 inside their
  // arena-side, so equal non-bf footprint implies equal battlefield
  // height. Self hand cards stay full-size (--majik-card-h, 140px);
  // the opp strip gets extra vertical space inside it which reads
  // as centered empty space — fine, not a regression.
  //
  // Heights are co-located here (vs. board.scss) so they're loaded
  // in jsdom unit tests for the layout assertions in
  // board.component.spec.ts. Literal pixel values (vs. CSS vars)
  // since jsdom doesn't resolve var() through Angular's emulated
  // encapsulation. Math:
  //   tokens.scss → --majik-card-h: 140px, --majik-space-2: 8px
  //   hand-h = 140 + 8*2 = 156px   (full-size hand-card row)
  //   info-h =       8*4 =  32px   (compact HUD/mana row)
  //   strip-h = hand-h + info-h = 188px  (opp's one strip)
  styles: [`
    :host {
      display: flex;
      flex: 1 1 0;
      min-height: 0;
      flex-direction: column;
    }
    .arena-side--foe .arena-strip {
      flex: 0 0 188px;
      min-height: 188px;
      max-height: 188px;
      align-items: center;
    }
    .arena-side--self > .hand-row {
      flex: 0 0 156px;
      min-height: 156px;
      max-height: 156px;
    }
    .arena-side--self > .arena-strip--self {
      flex: 0 0 32px;
      min-height: 32px;
      max-height: 32px;
    }
  `],
  // Layout overview (Arena-style, zoned battlefield):
  //
  //   ┌─────────────────────────────────────────────────────────────────┐
  //   │ phase-bar                                                       │
  //   ├─────────────────────────────────────────────────────────────────┤
  //   │ opp HUD + mana strip (compact)   |  opp hand (face-down)        │
  //   │ ─ opp .battlefield (.active-foe rim wraps both rows) ─────────  │
  //   │     .backline:  lands LEFT │ artifacts/enchants RIGHT          │
  //   │     .frontline: creatures (full-width, scrollable)             │
  //   │ ─────────────── centerline ──────────────────────────────────  │
  //   │     .frontline: creatures (full-width, scrollable)             │
  //   │     .backline:  lands LEFT │ artifacts/enchants RIGHT          │
  //   │ ─ self .battlefield (.active-self rim wraps both rows) ──────  │
  //   │ self hand-row (drag-drop, full width)                          │
  //   │ self HUD + mana strip (compact)                                │
  //   ├─────────────────────────────────────────────────────────────────┤
  //   │ action-bar                                                      │
  //   └─────────────────────────────────────────────────────────────────┘
  //
  //   Stack chip floats as a small corner badge over the board area
  //   (top-right), still clickable to expand its contents. Doesn't eat a
  //   row anymore so the battlefield can claim that vertical space.
  //
  // Bucketing is a pure function (bucketBattlefield) so the visual
  // zones stay unit-testable. The self-side keeps ONE cdkDropList
  // (#self-battlefield-droplist) that covers the entire .battlefield
  // region — the inner .frontline / .backline are CSS placement only,
  // not drop targets. Drag-from-hand → battlefield still resolves to
  // castOrPlayRequested via that single droplist.
  //
  // Whose-turn ambient rim moves to the .battlefield wrapper so it
  // surrounds frontline + backline together for each side. Combat-
  // assignment SVG arrows query creatures via .frontline now; the
  // overlay still measures off .board-grid.
  //
  // Zone transitions: card-view nodes track by instanceId, so as the
  // reducer patches state in place (event.reducer.ts), Angular's
  // animate.enter / animate.leave directives fire when a card appears in
  // or disappears from a zone. Keyframes live in board.scss.
  template: `
    @if (state(); as s) {
      <div class="flex flex-1 flex-col">
        <app-phase-bar
          [phase]="s.phase"
          [turn]="s.turnNumber"
          [stops]="phaseStops()"
          (stopToggled)="phaseStopToggled.emit($event)" />

        <!--
          Screen-reader announcer. Single polite region driven by
          GameStore.lastAnnouncement, bumped on every patch via the
          announcementFor() composer.
        -->
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          {{ liveAnnouncement() }}
        </div>

        <div #boardGrid class="board-arena relative flex flex-1 flex-col gap-2 p-3">
          <!--
            Opponent zone (vertical flip of the self side; same screen
            LR for lands/utility). Compact HUD + mana strip + face-down
            hand sit at the TOP edge; the battlefield wrapper carries
            the active-foe rim around backline-top + frontline-bottom
            so creatures meet the centerline.
          -->
          <div class="arena-side arena-side--foe">
            <div class="arena-strip">
              <app-player-hud
                class="arena-strip__hud"
                [player]="opponent()"
                [active]="opponent()?.id === s.activePlayerId"
                side="opponent"
                label="opponent" />
              <app-mana-pool-row class="arena-strip__mana" [player]="opponent()" />
              <!--
                CR 706.2 — opponent's graveyard pile (public zone, browsable
                by either player). Click → modal with the full pile.
              -->
              @if (opponent(); as opp) {
                <app-graveyard-pile
                  class="arena-strip__graveyard"
                  [cards]="opp.graveyard.cards"
                  ownerSide="opponent"
                  [ownerName]="opp.name"
                  (expand)="openGraveyard('opponent')" />
              }
              <!--
                Opponent hand (face-down). Server emits the opponent's
                hand as N "(hidden)" placeholder cards via the per-viewer
                mask in StateSnapshotter (CR 706) — we render one face-
                down card per placeholder so the count is visually obvious
                without leaking names.
              -->
              <div class="hand-row hand-row--opponent arena-strip__hand" role="list"
                   [attr.aria-label]="'opponent hand, ' + opponentHandCount() + ' cards'">
                @for (c of opponent()?.hand?.cards ?? []; track $index) {
                  <app-card-view
                    role="listitem"
                    [snapshot]="c"
                    [hidden]="true"
                    animate.enter="zone-enter-from-top"
                    animate.leave="zone-leave-up" />
                } @empty {
                  <span class="opacity-30 text-xs">— opponent hand empty —</span>
                }
              </div>
            </div>

            <div
              class="battlefield battlefield--foe"
              [class.battlefield--active-foe]="opponent()?.id === s.activePlayerId"
              [class.battlefield--inactive]="opponent()?.id !== s.activePlayerId"
              data-side="opponent">
              @if (oppBuckets(); as b) {
                <!-- Opponent backline is on TOP (away from the
                     centerline). Lands LEFT, utility RIGHT — same screen
                     LR as the self side. -->
                <div class="backline" data-zone="backline">
                  <div class="backline__lands" data-zone="lands" role="list"
                       aria-label="opponent lands">
                    @for (c of b.lands; track c.instanceId) {
                      <app-card-view
                        role="listitem"
                        [snapshot]="c"
                        [attr.data-card-id]="c.instanceId"
                        zone="battlefield"
                        animate.enter="zone-enter-from-top"
                        animate.leave="zone-leave-down"
                        (contextmenu)="onContextMenu($event, c, 'opponent')" />
                    }
                  </div>
                  <div class="backline__utility" data-zone="utility" role="list"
                       aria-label="opponent artifacts and enchantments">
                    @for (c of b.utility; track c.instanceId) {
                      <app-card-view
                        role="listitem"
                        [snapshot]="c"
                        [attr.data-card-id]="c.instanceId"
                        zone="battlefield"
                        animate.enter="zone-enter-from-top"
                        animate.leave="zone-leave-down"
                        (contextmenu)="onContextMenu($event, c, 'opponent')" />
                    }
                  </div>
                </div>
                <!-- Frontline ON BOTTOM for opponent — closest to the
                     centerline so creatures meet. Full-width row,
                     overflow-x: auto on overflow. -->
                <div class="frontline" data-zone="frontline" role="list"
                     aria-label="opponent creatures">
                  @for (c of b.frontline; track c.instanceId) {
                    <app-card-view
                      role="listitem"
                      [snapshot]="c"
                      [attr.data-card-id]="c.instanceId"
                      zone="battlefield"
                      animate.enter="zone-enter-from-top"
                      animate.leave="zone-leave-down"
                      (contextmenu)="onContextMenu($event, c, 'opponent')" />
                  }
                </div>
                @if (b.frontline.length === 0 && b.lands.length === 0 && b.utility.length === 0) {
                  <span class="battlefield__empty opacity-30">— opponent battlefield empty —</span>
                }
              }
            </div>
          </div>

          <!--
            Self zone. Mirror of the opponent: frontline ON TOP (toward
            the centerline so creatures meet), backline ON BOTTOM —
            lands LEFT, utility RIGHT. ONE cdkDropList wraps the whole
            .battlefield so drag-from-hand resolves to onBattlefieldDrop
            regardless of which inner bucket the user releases over.
          -->
          <div class="arena-side arena-side--self">
            <div
              #selfBattlefieldList="cdkDropList"
              id="self-battlefield-droplist"
              class="battlefield battlefield--self"
              [class.battlefield--active-self]="self()?.id === s.activePlayerId"
              [class.battlefield--inactive]="self()?.id !== s.activePlayerId"
              data-side="self"
              cdkDropList
              cdkDropListSortingDisabled
              [cdkDropListConnectedTo]="['self-hand-droplist']"
              (cdkDropListDropped)="onBattlefieldDrop($event)">
              @if (selfBuckets(); as b) {
                <!-- Frontline ON TOP for self — adjacent to the
                     centerline. Full-width single row, overflow-x: auto
                     when crowded. -->
                <div class="frontline" data-zone="frontline" role="list"
                     aria-label="your creatures">
                  @for (c of b.frontline; track c.instanceId) {
                    <app-card-view
                      role="listitem"
                      [snapshot]="c"
                      [attr.data-card-id]="c.instanceId"
                      zone="battlefield"
                      animate.enter="zone-enter-from-bottom"
                      animate.leave="zone-leave-up"
                      (contextmenu)="onContextMenu($event, c, 'self')"
                      (cardDoubleClick)="onSelfBattlefieldDoubleClick($event)" />
                  }
                </div>
                <div class="backline" data-zone="backline">
                  <div class="backline__lands" data-zone="lands" role="list"
                       aria-label="your lands">
                    @for (c of b.lands; track c.instanceId) {
                      <app-card-view
                        role="listitem"
                        [snapshot]="c"
                        [attr.data-card-id]="c.instanceId"
                        zone="battlefield"
                        animate.enter="zone-enter-from-bottom"
                        animate.leave="zone-leave-up"
                        (contextmenu)="onContextMenu($event, c, 'self')"
                        (cardDoubleClick)="onSelfBattlefieldDoubleClick($event)" />
                    }
                  </div>
                  <div class="backline__utility" data-zone="utility" role="list"
                       aria-label="your artifacts and enchantments">
                    @for (c of b.utility; track c.instanceId) {
                      <app-card-view
                        role="listitem"
                        [snapshot]="c"
                        [attr.data-card-id]="c.instanceId"
                        zone="battlefield"
                        animate.enter="zone-enter-from-bottom"
                        animate.leave="zone-leave-up"
                        (contextmenu)="onContextMenu($event, c, 'self')"
                        (cardDoubleClick)="onSelfBattlefieldDoubleClick($event)" />
                    }
                  </div>
                </div>
                @if (b.frontline.length === 0 && b.lands.length === 0 && b.utility.length === 0) {
                  <span class="battlefield__empty opacity-30">— your battlefield empty —</span>
                }
              }
            </div>

            <div
              #selfHandList="cdkDropList"
              id="self-hand-droplist"
              class="hand-row"
              role="list"
              aria-label="your hand"
              cdkDropList
              cdkDropListOrientation="horizontal"
              [cdkDropListConnectedTo]="['self-battlefield-droplist']"
              (cdkDropListDropped)="onHandDrop($event)">
              @for (c of orderedSelfHand(); track c.instanceId) {
                <button
                  type="button"
                  role="listitem"
                  class="bg-transparent p-0 focus:outline focus:outline-2 focus:outline-amber-400"
                  cdkDrag
                  [cdkDragData]="c"
                  [attr.aria-label]="'play ' + c.name"
                  animate.enter="zone-enter-from-top"
                  animate.leave="zone-leave-down">
                  <app-card-view
                    [snapshot]="c"
                    zone="hand"
                    [castable]="castableIds().has(c.instanceId)" />
                  <div *cdkDragPlaceholder class="hand-card-placeholder"></div>
                </button>
              } @empty {
                <span class="opacity-30">— hand empty —</span>
              }
            </div>

            <div class="arena-strip arena-strip--self">
              <app-player-hud
                class="arena-strip__hud"
                [player]="self()"
                [active]="self()?.id === s.activePlayerId"
                side="self"
                label="you" />
              <app-mana-pool-row class="arena-strip__mana" [player]="self()" />
              <!--
                CR 706.2 — your own graveyard pile. Click → modal with
                the full pile. Read-only view (no graveyard-tutor /
                regrowth wiring yet — separate slice).
              -->
              @if (self(); as me) {
                <app-graveyard-pile
                  class="arena-strip__graveyard"
                  [cards]="me.graveyard.cards"
                  ownerSide="self"
                  [ownerName]="me.name"
                  (expand)="openGraveyard('self')" />
              }
            </div>
          </div>

          <!--
            Stack — collapsed to a small corner chip so it doesn't eat a
            row of vertical space. Click toggles the expanded contents
            list. Newest at the top — resolution reads top → bottom.
            Floats absolute in the top-right of the board area.
          -->
          <aside
            class="stack-chip"
            [class.stack-chip--populated]="s.stack.length > 0"
            [class.stack-chip--open]="stackExpanded()"
            aria-label="stack">
            <button
              type="button"
              class="stack-chip__toggle"
              [attr.aria-expanded]="stackExpanded()"
              (click)="toggleStack()">
              Stack ({{ s.stack.length }})
            </button>
            @if (stackExpanded()) {
              <div class="stack-chip__body">
                @for (item of reversedStack(); track item.id; let i = $index) {
                  <div
                    class="stack-item py-1 text-xs"
                    [class.stack-item--top]="i === 0"
                    [class.stack-item--trigger]="item.kind === 'TriggeredAbility'"
                    [attr.data-stack-kind]="item.kind"
                    animate.enter="stack-item-enter"
                    animate.leave="stack-item-leave">
                    <div class="font-semibold">{{ item.kind }}</div>
                    <div class="opacity-70">{{ item.description }}</div>
                  </div>
                } @empty {
                  <p class="text-xs opacity-40">empty</p>
                }
              </div>
            } @else {
              <!--
                Keep stack items mounted (display: none) when collapsed so
                the existing spec which queries .stack-item from a flat
                DOM still works regardless of expanded state. The chip
                pulse + trigger highlight remain visible via the toggle's
                outer styling when populated.
              -->
              <div class="stack-chip__body stack-chip__body--collapsed">
                @for (item of reversedStack(); track item.id; let i = $index) {
                  <div
                    class="stack-item py-1 text-xs"
                    [class.stack-item--top]="i === 0"
                    [class.stack-item--trigger]="item.kind === 'TriggeredAbility'"
                    [attr.data-stack-kind]="item.kind">
                    <div class="font-semibold">{{ item.kind }}</div>
                    <div class="opacity-70">{{ item.description }}</div>
                  </div>
                }
              </div>
            }
          </aside>

          <!--
            SVG combat-assignment overlay. Layered above the board cells
            (pointer-events: none so card interactions still work). The
            modal-driven attackers/blockers prompt remains the source of
            truth for keyboard a11y — this is purely a visual augment.
          -->
          @if (combatLines().length > 0) {
            <svg
              class="combat-overlay"
              [attr.width]="overlaySize().w"
              [attr.height]="overlaySize().h"
              aria-hidden="true">
              @for (line of combatLines(); track line.id) {
                <path
                  [attr.d]="line.d"
                  [attr.stroke]="line.color"
                  [attr.stroke-dasharray]="line.dashed ? '6 4' : null"
                  stroke-width="2"
                  fill="none"
                  stroke-linecap="round" />
              }
            </svg>
          }
        </div>

        <app-action-bar
          [canPass]="canPass()"
          [currentPrompt]="currentPrompt()"
          (pass)="passClicked.emit()"
          (concede)="concedeClicked.emit()"
          (undoRequested)="undoClicked.emit()" />

        <app-card-context-menu
          [card]="activeContextCard()"
          [position]="activeContextPos()"
          [canTap]="canTapActiveContext()"
          [activatableAbilities]="activeContextActivatableAbilities()"
          (closed)="closeContextMenu()"
          (action)="onContextAction($event)"
          (activateAbilityRequested)="onContextActivateAbility($event)" />

        @if (manaPicker(); as mp) {
          <app-mana-color-picker
            [colors]="mp.colors"
            [anchorRect]="mp.anchorRect"
            (colorSelected)="onManaColorPicked($event)"
            (dismiss)="closeManaPicker()" />
        }

        <!-- CR 706.2 — graveyard browse modal. Whichever side's pile was
             clicked drives ownerName / cards via openedGraveyard(). -->
        @if (openedGraveyard(); as gy) {
          <app-graveyard-modal
            [ownerName]="gy.ownerName"
            [cards]="gy.cards"
            (closed)="closeGraveyard()" />
        }
      </div>
    } @else {
      <p class="p-4 opacity-60">No game state.</p>
    }
  `
})
export class BoardComponent implements AfterViewInit, OnDestroy {
  readonly state = input<GameState | null>(null);
  readonly selfPlayerIds = input<string[]>([]);
  readonly currentPrompt = input<{ expectedKinds?: string[]; description?: string } | null>(null);
  readonly phaseStops = input<PhaseStops>({});
  // In-progress combat-assignment state forwarded from the prompt
  // overlay. When the user toggles an attacker/blocker the overlay
  // emits assignmentsChanged; match.ts forwards it down here so the
  // SVG layer can render arrows while the modal is still open.
  readonly liveAssignments = input<{
    kind: 'attackers' | 'blockers' | null;
    attackers?: { attackerInstanceId: string; defenderId: string }[];
    blockers?: { attackerInstanceId: string; blockerInstanceId: string }[];
  } | null>(null);
  readonly passClicked = output<void>();
  /**
   * Drag-from-hand-to-self-battlefield request. Replaces the prior
   * click-to-cast affordance — pairs with majik.core #438 which made
   * the cast flow pay from the floating pool first and adds a
   * CancelCastCommand backstop.
   */
  readonly castOrPlayRequested = output<CardSnapshot>();
  readonly phaseStopToggled = output<string>();
  readonly concedeClicked = output<void>();
  readonly undoClicked = output<void>();
  /**
   * UI stub for the context-menu Tap / Untap entry. The engine doesn't
   * expose a "tap this permanent" command today (taps happen as a side
   * effect of activating an ability or attacking), so the page-level
   * handler logs a TODO. Emitted only for self-owned battlefield cards.
   */
  readonly tapToggleRequested = output<CardSnapshot>();
  /**
   * Emitted when the viewer double-clicks one of their own permanents
   * to activate a mana ability. The page translates this into the
   * matching ActivateManaAbilityCommand.
   */
  readonly activateManaRequested = output<{ card: CardSnapshot; color: string }>();
  /**
   * Emitted when the viewer double-clicks a permanent that has a
   * non-mana activated ability (e.g. Verdant Catacombs). The page
   * translates this into an ActivateAbilityCommand.
   */
  readonly activateAbilityRequested = output<{ permanentInstanceId: string; abilityId: string }>();
  /**
   * Emitted when the viewer activates one of their planeswalker's loyalty
   * abilities (CR 606) via the context menu. The page translates this
   * into an ActivateLoyaltyAbilityCommand. `loyaltyAbilityId` is the
   * AbilityDto.id of the chosen (+N / −N) ability.
   */
  readonly activateLoyaltyAbilityRequested =
    output<{ permanentInstanceId: string; loyaltyAbilityId: string }>();

  // Context-menu state. `activeContextCard` doubles as the visibility
  // flag — when null the menu hides. Position is the page coords of the
  // right-click event, clamped inside the viewport by the menu itself.
  readonly activeContextCard = signal<CardSnapshot | null>(null);
  readonly activeContextPos = signal<{ x: number; y: number } | null>(null);
  // Tracks which side's battlefield the active context card belongs to,
  // so the menu can hide Tap / Untap for opponent permanents.
  readonly activeContextOwner = signal<'self' | 'opponent' | null>(null);

  /**
   * Activatable abilities legal to surface in the context menu for the
   * currently right-clicked card. Filters to:
   *   * self-owned only (opponent permanents get no Activate entries —
   *     the viewer can't activate their abilities); and
   *   * `kind === 'Activated'` with a non-null `id` (mirrors the
   *     onSelfBattlefieldDoubleClick guard so an older server build that
   *     hasn't deployed AbilityDto.Id keeps the menu safe).
   * Empty array hides the Activate entries entirely.
   */
  readonly activeContextActivatableAbilities = computed<ActivatableAbility[]>(() => {
    const card = this.activeContextCard();
    const owner = this.activeContextOwner();
    if (!card || owner !== 'self') return [];
    const abilities = card.abilities ?? [];
    const activated: ActivatableAbility[] = abilities
      .filter(a => a.kind === 'Activated' && a.id != null)
      .map(a => ({ id: a.id!, description: a.description ?? '', kind: 'activated' as const }));
    // CR 606 — planeswalker loyalty abilities. The engine only advertises
    // these (with a non-null id) when legal rules-wise, and gates the
    // expected-kind on the player's sorcery-speed priority; we mirror that
    // by requiring the loyalty-activation kind in the current prompt AND
    // defensively dropping any −N ability the player can't afford
    // (current loyalty < N). +N abilities are always affordable.
    const loyalty: ActivatableAbility[] = this.loyaltyActivationAllowed()
      ? abilities
          .filter(a => a.kind === 'Loyalty' && a.id != null)
          .filter(a => this.loyaltyAbilityAffordable(card, a.description ?? ''))
          .map(a => ({ id: a.id!, description: a.description ?? '', kind: 'loyalty' as const }))
      : [];
    return [...activated, ...loyalty];
  });

  /**
   * True when the clicked context card may show a Tap / Untap entry: it
   * is self-owned AND it can actually tap. Planeswalkers (CR 306) don't
   * tap to any purpose, so they're excluded — surfacing Tap on a
   * planeswalker would be a meaningless affordance. (Other non-tappable
   * permanents could be excluded too once the engine flags them; the
   * minimum here is Planeswalker.)
   */
  readonly canTapActiveContext = computed<boolean>(() => {
    if (this.activeContextOwner() !== 'self') return false;
    const card = this.activeContextCard();
    return !!card && !isPlaneswalker(card);
  });

  /**
   * True when the current prompt's expected kinds advertise the
   * loyalty-activation kind — i.e. the engine says the viewer has
   * sorcery-speed priority to activate a loyalty ability this turn. The
   * engine names freeform kind strings over SignalR, so we match any
   * kind whose lowercased form mentions "loyalty".
   */
  private readonly loyaltyActivationAllowed = computed<boolean>(() => {
    const p = this.currentPrompt();
    if (!p) return false;
    return (p.expectedKinds ?? []).some(k => k.toLowerCase().includes('loyalty'));
  });

  // Mana color-picker popover state. `manaPicker()` is non-null while
  // the chooser is visible; carries the card we're activating + its
  // anchor rect for positioning.
  readonly manaPicker = signal<{
    card: CardSnapshot;
    colors: string;
    anchorRect: DOMRect;
  } | null>(null);

  private readonly popover = inject(CardPopoverService);

  // CR 706.2 — currently-expanded graveyard pile. Null = no modal open.
  // Stores the owner side so openedGraveyard() can re-derive the live
  // cards / name from the current game state (so cards added while the
  // modal is open appear without re-clicking).
  private readonly openedGraveyardSide = signal<'self' | 'opponent' | null>(null);
  readonly openedGraveyard = computed<{ ownerName: string; cards: CardSnapshot[] } | null>(() => {
    const side = this.openedGraveyardSide();
    if (!side) return null;
    const player = side === 'self' ? this.self() : this.opponent();
    if (!player) return null;
    return { ownerName: player.name, cards: player.graveyard.cards };
  });

  openGraveyard(side: 'self' | 'opponent'): void {
    this.openedGraveyardSide.set(side);
  }

  closeGraveyard(): void {
    this.openedGraveyardSide.set(null);
  }

  onContextMenu(event: MouseEvent, card: CardSnapshot, owner: 'self' | 'opponent'): void {
    event.preventDefault();
    // Pin the hover popover down — it was likely visible at right-click
    // time and the user just expressed intent to interact, not browse.
    this.popover.hide();
    this.activeContextCard.set(card);
    this.activeContextPos.set({ x: event.clientX, y: event.clientY });
    this.activeContextOwner.set(owner);
  }

  closeContextMenu(): void {
    this.activeContextCard.set(null);
    this.activeContextPos.set(null);
    this.activeContextOwner.set(null);
  }

  /**
   * Double-click on a self-owned battlefield permanent: activate a mana
   * ability or a non-mana activated ability.
   *
   * Priority order:
   *   1. Mana producers (producedManaColors non-empty) → ActivateManaAbilityCommand.
   *      Single-color fires directly; multi-color opens the color picker.
   *   2. Non-mana activated abilities (abilities[].kind === 'Activated' with an id)
   *      → activateAbilityRequested (→ ActivateAbilityCommand).
   *      For now we pick the FIRST matching entry; multi-ability picking is
   *      TODO once the engine exposes a picker prompt.
   *   3. Otherwise → no-op.
   *
   * Already-tapped permanents are ignored for both paths ({T} costs require
   * an untapped permanent; the engine enforces this authoritatively).
   *
   * TODO: ability picker for multi-ability permanents
   */
  onSelfBattlefieldDoubleClick(card: CardSnapshot): void {
    if (card.tapped) return;
    const colors = card.producedManaColors ?? '';
    if (colors.length > 0) {
      // Mana-ability path (existing behaviour).
      this.popover.hide();
      if (colors.length === 1) {
        this.activateManaRequested.emit({ card, color: colors });
        return;
      }
      const grid = this.boardGridEl?.nativeElement;
      const el = grid?.querySelector(
        `.arena-side--self .battlefield [data-card-id="${card.instanceId}"]`
      ) as HTMLElement | null;
      if (!el) return;
      this.manaPicker.set({ card, colors, anchorRect: el.getBoundingClientRect() });
      return;
    }
    // Non-mana activated-ability path. Requires the companion core PR to
    // deploy AbilityDto.Id; until then `id` will be null/undefined and
    // this branch is a safe no-op.
    const activatedAbility = (card.abilities ?? []).find(
      a => a.kind === 'Activated' && a.id != null
    );
    if (activatedAbility) {
      // TODO: ability picker for multi-ability permanents
      this.activateAbilityRequested.emit({
        permanentInstanceId: card.instanceId,
        abilityId: activatedAbility.id!,
      });
    }
  }

  onManaColorPicked(color: string): void {
    const mp = this.manaPicker();
    if (!mp) return;
    this.manaPicker.set(null);
    this.activateManaRequested.emit({ card: mp.card, color });
  }

  closeManaPicker(): void {
    this.manaPicker.set(null);
  }

  /**
   * Context-menu "Activate …" entry fired: re-emit upward with the
   * permanent's instanceId so the page dispatches an
   * ActivateAbilityCommand. Same output shape as the double-click
   * path — only the trigger differs. Owner is implicitly self (the
   * computed `activeContextActivatableAbilities` filters opponent
   * permanents out).
   */
  onContextActivateAbility(ability: ActivatableAbility): void {
    const card = this.activeContextCard();
    if (!card) return;
    if (ability.kind === 'loyalty') {
      this.activateLoyaltyAbilityRequested.emit({
        permanentInstanceId: card.instanceId,
        loyaltyAbilityId: ability.id,
      });
      return;
    }
    this.activateAbilityRequested.emit({
      permanentInstanceId: card.instanceId,
      abilityId: ability.id,
    });
  }

  /**
   * Whether the player can afford a loyalty ability whose signed-cost
   * description is `desc` ("+1", "−2", "−5", "0"). A −N ability requires
   * current loyalty ≥ N (CR 606.5 — you can't pay loyalty you don't
   * have). +N and 0 abilities are always affordable. Current loyalty
   * comes from the snapshot's "Loyalty" counter; absent ⇒ treat as 0 so
   * minus abilities are hidden until the engine reports loyalty.
   */
  private loyaltyAbilityAffordable(card: CardSnapshot, desc: string): boolean {
    const cost = parseLoyaltyCost(desc);
    if (cost == null) return true; // unparseable ⇒ let the engine arbitrate
    if (cost >= 0) return true;
    const loyalty = card.counters?.['Loyalty'] ?? 0;
    return loyalty >= -cost;
  }

  /**
   * Route a context-menu action to the right destination:
   *   * `tap`      — re-emit upward so the page can log the stub.
   *   * `details`  — open the hover popover at the click position.
   *   * `scryfall` — open the search URL in a new tab.
   */
  onContextAction(a: CardContextMenuAction): void {
    const card = this.activeContextCard();
    const pos = this.activeContextPos();
    if (!card) return;
    switch (a) {
      case 'tap':
        if (this.activeContextOwner() === 'self') {
          this.tapToggleRequested.emit(card);
        }
        break;
      case 'details':
        if (pos) {
          // Build a minimal DOMRect at the click position so the popover
          // positioner has somewhere to anchor. The popover clamps inside
          // the viewport on its own.
          const rect = new DOMRect(pos.x, pos.y, 0, 0);
          this.popover.show(snapshotToCard(card), rect);
        }
        break;
      case 'scryfall':
        if (typeof window !== 'undefined') {
          const url = `https://scryfall.com/search?q=${encodeURIComponent(`!"${card.name}"`)}`;
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        break;
    }
  }

  private readonly gameStore = inject(GameStore);

  // Aria-live announcement string — we prefix with a zero-width space
  // tied to a sequence number so identical-text re-emits force a fresh
  // SR read (screen readers de-dupe by literal text per region).
  readonly liveAnnouncement = computed<string>(() => {
    const text = this.gameStore.lastAnnouncement();
    const seq = this.gameStore.lastAnnouncementSeq();
    if (!text) return '';
    // Alternate a trailing space every other seq so the polite region
    // sees a fresh string even on repeat content.
    return seq % 2 === 0 ? text : text + ' ';
  });

  @ViewChild('boardGrid') private boardGridEl?: ElementRef<HTMLElement>;

  // Recomputation trigger for SVG line coords. Bumped on resize +
  // whenever liveAssignments changes — the actual measurement happens
  // off this signal via afterNextRender / effect.
  private readonly measureTick = signal(0);

  // Backing store for the computed line list. We can't read DOM rects
  // inside a pure computed (no element refs guaranteed in change-detection
  // order), so the path strings + colors are derived in
  // recomputeCombatLines() and stashed here.
  readonly combatLines = signal<{
    id: string;
    d: string;
    color: string;
    dashed: boolean;
  }[]>([]);

  readonly overlaySize = signal<{ w: number; h: number }>({ w: 0, h: 0 });

  private resizeHandler = (): void => {
    this.measureTick.update(n => n + 1);
  };

  constructor() {
    // Recompute combat lines whenever the assignment input or measure
    // tick changes. rAF defer so the underlying card DOM nodes have
    // been painted before we sample their rects.
    effect(() => {
      this.liveAssignments();
      this.measureTick();
      this.state();
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => this.recomputeCombatLines());
      } else {
        this.recomputeCombatLines();
      }
    });
  }

  ngAfterViewInit(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler);
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
    }
  }

  private recomputeCombatLines(): void {
    const grid = this.boardGridEl?.nativeElement;
    const assignments = this.liveAssignments();
    if (!grid || !assignments || !assignments.kind) {
      if (this.combatLines().length > 0) this.combatLines.set([]);
      return;
    }
    const hostRect = grid.getBoundingClientRect();
    this.overlaySize.set({ w: hostRect.width, h: hostRect.height });

    const lines: { id: string; d: string; color: string; dashed: boolean }[] = [];

    if (assignments.kind === 'attackers') {
      // Attacker arrows: from each declared attacker card center down
      // to the opponent HUD anchor. We pull the .player-hud anchor on
      // the foe frame as the target since the prompt currently only
      // supports defender = opponent (no planeswalkers yet).
      const foeAnchor = grid.querySelector('.arena-side--foe .player-hud') as HTMLElement | null;
      const foeRect = foeAnchor?.getBoundingClientRect();
      if (!foeRect) return;
      const target = {
        x: foeRect.left + foeRect.width / 2 - hostRect.left,
        y: foeRect.top + foeRect.height / 2 - hostRect.top,
      };
      for (const a of assignments.attackers ?? []) {
        // Creatures live in .frontline now (zoned battlefield). The
        // battlefield wrapper still wraps everything so we could query
        // it instead, but scoping to .frontline keeps the measurement
        // unambiguously over a creature, never over a backline card
        // that happens to share an instanceId across DOM (it never
        // does, but defensive scoping costs nothing).
        const card = grid.querySelector(
          `.arena-side--self .frontline [data-card-id="${a.attackerInstanceId}"]`
        ) as HTMLElement | null;
        if (!card) continue;
        const r = card.getBoundingClientRect();
        const from = {
          x: r.left + r.width / 2 - hostRect.left,
          y: r.top + r.height / 2 - hostRect.top,
        };
        lines.push({
          id: `atk-${a.attackerInstanceId}`,
          d: curvedPath(from, target),
          color: 'var(--text-err)',
          dashed: true,
        });
      }
    } else if (assignments.kind === 'blockers') {
      for (const b of assignments.blockers ?? []) {
        const blockerEl = grid.querySelector(
          `.arena-side--self .frontline [data-card-id="${b.blockerInstanceId}"]`
        ) as HTMLElement | null;
        const attackerEl = grid.querySelector(
          `.arena-side--foe .frontline [data-card-id="${b.attackerInstanceId}"]`
        ) as HTMLElement | null;
        if (!blockerEl || !attackerEl) continue;
        const bRect = blockerEl.getBoundingClientRect();
        const aRect = attackerEl.getBoundingClientRect();
        const from = {
          x: bRect.left + bRect.width / 2 - hostRect.left,
          y: bRect.top + bRect.height / 2 - hostRect.top,
        };
        const to = {
          x: aRect.left + aRect.width / 2 - hostRect.left,
          y: aRect.top + aRect.height / 2 - hostRect.top,
        };
        lines.push({
          id: `blk-${b.blockerInstanceId}-${b.attackerInstanceId}`,
          d: curvedPath(from, to),
          color: 'var(--mana-u)',
          dashed: true,
        });
      }
    }

    this.combatLines.set(lines);
  }

  /**
   * Collapsed-by-default toggle for the floating stack chip. The chip
   * always shows a count + pulse on the corner; expanding reveals the
   * items list. Default collapsed = reclaim vertical space for the
   * battlefield (the whole point of this refactor).
   */
  readonly stackExpanded = signal<boolean>(false);

  toggleStack(): void {
    this.stackExpanded.update(v => !v);
  }

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

  /**
   * Pure-function bucketing for the self battlefield. Frontline =
   * creatures (toward the centerline); backline = lands LEFT + utility
   * (artifacts / enchantments / planeswalkers) RIGHT. See
   * bucketBattlefield() for details + unit tests.
   */
  readonly selfBuckets = computed<BattlefieldBuckets>(() => {
    return bucketBattlefield(this.self()?.battlefield?.cards);
  });

  readonly oppBuckets = computed<BattlefieldBuckets>(() => {
    return bucketBattlefield(this.opponent()?.battlefield?.cards);
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

  // Cheap "can I cast?" heuristic. The full check needs color
  // requirements + cost reduction effects + alternative costs, but
  // a CMC-vs-pool-sum prefilter is a useful "this is even plausible"
  // hint — the engine will reject anything that fails the real rules.
  //
  // Active only when:
  //   * a `none`-kind prompt is open against the viewer (priority is
  //     ours and there's no specific question to answer);
  //   * for non-land cards: parsed CMC <= sum(mana pool).
  // Land cards always glow when priority is ours — the engine will
  // veto land drops outside main / non-empty stack / second-this-turn.
  readonly castableIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    if (!this.hasPriority()) return ids;
    const me = this.self();
    if (!me) return ids;
    const pool = totalMana(me.mana);
    for (const c of me.hand.cards) {
      if ((c.types ?? []).some(t => t.toLowerCase() === 'land')) {
        ids.add(c.instanceId);
        continue;
      }
      if (cmcOf(c.manaCost) <= pool) ids.add(c.instanceId);
    }
    return ids;
  });

  // Pass-priority button gate. The match shell only forwards
  // `currentPrompt` when the prompt is addressed to THIS viewer (see
  // match.ts `myPromptSummary`, gated on `isMyTurnPrompt`), so a
  // non-null prompt here already means "the engine is awaiting me".
  // We additionally require the prompt advertise `PassPriorityCommand`
  // so the button is enabled ONLY during a genuine priority window —
  // never during a target / surveil / yes-no / mulligan / combat
  // sub-prompt (those carry their own command kinds, not
  // PassPriorityCommand, and have dedicated overlay UI). When no
  // prompt is pending (opponent's window, engine resolving the stack,
  // between turns) the button stays disabled.
  readonly canPass = computed<boolean>(() => {
    const p = this.currentPrompt();
    if (!p) return false;
    return isPriorityPrompt(p.expectedKinds);
  });

  private readonly hasPriority = computed<boolean>(() => {
    const p = this.currentPrompt();
    if (!p) return false;
    const ks = (p.expectedKinds ?? []).map(k => k.toLowerCase());
    // The match shell only forwards the prompt when it belongs to the
    // viewer (see match.ts myPromptSummary), so any prompt at all is
    // a priority signal. We still drill into kinds because anything
    // other than `none` means there's a specific question that
    // shouldn't be confused with "free to cast whatever".
    if (ks.length === 0) return true;
    if (ks.includes('none')) return true;
    // Anything else is a targeted question — don't paint the whole
    // hand as castable; the user is mid-flow on a specific input.
    return false;
  });

  onHandDrop(event: CdkDragDrop<CardSnapshot[]>): void {
    // Hand-to-hand drop = reorder. Cross-container drops (hand →
    // battlefield) surface on the destination droplist instead, so
    // ignore them here.
    if (event.previousContainer !== event.container) return;
    const next = this.orderedSelfHand().slice();
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.handOrder.set(next.map(c => c.instanceId));
  }

  /**
   * Drop on the self-battlefield droplist. Only acts on cross-container
   * drops (hand → battlefield); sortingDisabled is set on the
   * destination so battlefield-to-battlefield drags don't reorder the
   * grid. The dragged CardSnapshot is carried via cdkDragData.
   */
  onBattlefieldDrop(event: CdkDragDrop<unknown>): void {
    if (event.previousContainer === event.container) return;
    const card = event.item?.data as CardSnapshot | undefined;
    if (!card) return;
    this.castOrPlayRequested.emit(card);
  }
}

// CR 306 — is this permanent a planeswalker? Type-line match,
// case-insensitive, tolerant of an absent/empty types array.
export function isPlaneswalker(card: { types?: string[] | null }): boolean {
  return (card.types ?? []).some(t => t.toLowerCase() === 'planeswalker');
}

// Parse a planeswalker loyalty-ability cost from its AbilityDto
// description ("+1", "−2", "−5", "0"). The engine renders minus signs as
// the U+2212 MINUS SIGN ("−") rather than ASCII hyphen, so both are
// accepted. Returns the signed integer, or null when unparseable (callers
// then defer to the engine for legality).
export function parseLoyaltyCost(desc: string | null | undefined): number | null {
  if (!desc) return null;
  // Normalise the unicode minus sign to ASCII before parsing.
  const norm = desc.trim().replace(/−/g, '-');
  const m = /^([+-]?)(\d+)$/.exec(norm);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return m[1] === '-' ? -n : n;
}

// Parse a mana-cost token string ("{1}{G}{G}", "{X}{R}", "{W/U}{B}") to
// a converted mana cost. Numeric tokens contribute their integer; any
// other token (color, hybrid, phyrexian, snow) contributes 1. {X}
// contributes 0 — X is uncapped at cast time, so a CMC heuristic
// can't reason about it without an actual choice.
export function cmcOf(cost: string | null | undefined): number {
  if (!cost) return 0;
  let total = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const tok = m[1].toUpperCase();
    if (tok === 'X' || tok === 'Y' || tok === 'Z') continue;
    if (/^\d+$/.test(tok)) {
      total += parseInt(tok, 10);
      continue;
    }
    // Color / hybrid / phyrexian / snow — one mana each.
    total += 1;
  }
  return total;
}

// Sum every bucket in the engine's ManaPool. The engine widens numeric
// fields through OpenAPI; coerce to Number defensively.
function totalMana(m: { white: number; blue: number; black: number; red: number; green: number; colorless: number; generic: number }): number {
  const n = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0);
  return n(m.white) + n(m.blue) + n(m.black) + n(m.red) + n(m.green) + n(m.colorless) + n(m.generic);
}

// SVG cubic-bezier between two points with the control points pulled
// vertically so the arc bulges away from the straight line. dx-derived
// curvature is bounded so very-close cards don't produce wild loops.
function curvedPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const curve = Math.min(80, dist * 0.25);
  // Bias the control points perpendicular to the line so the arc has
  // a consistent visual lift regardless of direction.
  const cx1 = from.x + dx * 0.25;
  const cy1 = from.y + dy * 0.25 - curve;
  const cx2 = from.x + dx * 0.75;
  const cy2 = from.y + dy * 0.75 - curve;
  return `M ${from.x},${from.y} C ${cx1},${cy1} ${cx2},${cy2} ${to.x},${to.y}`;
}
