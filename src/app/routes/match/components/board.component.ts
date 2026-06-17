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
import { GameState, GamePlayer, CardSnapshot, StackItem, SelectionMode } from '../../../core/match/match.types';
import { GameStore, PhaseStops } from '../../../core/match/game.store';
import { SelectionService } from '../../../core/match/selection.service';
import { isPriorityPrompt } from '../../../core/match/match-session';
import { CardViewComponent, snapshotToCard } from '../../../ui/card-view.component';
import { PlayerHudComponent } from '../../../ui/player-hud.component';
import { ManaPoolRowComponent } from '../../../ui/mana-pool-row.component';
import { PhaseBarComponent } from '../../../ui/phase-bar.component';
import { ActionBarComponent } from './action-bar.component';
import { LayoutControlsComponent } from './layout-controls.component';
import {
  ActivatableAbility,
  CardContextMenuAction,
  CardContextMenuComponent,
} from '../../../ui/card-context-menu.component';
import { CardPopoverService } from '../../../ui/card-popover.service';
import { ManaColorPickerComponent } from '../../../ui/mana-color-picker.component';
import { PromptDecision } from './prompt-overlay.component';
import { bucketBattlefield, BattlefieldBuckets } from './bucket-battlefield';
import { ZoneRailComponent } from './zone-rail.component';
import { ZoneModalComponent } from './zone-modal.component';
import { ZoneKind } from './zone-pile.component';
import { GameLogComponent } from './game-log.component';
import { LayoutPrefsService } from '../layout-prefs.service';
import { ViewportService } from '../../../core/ui/viewport.service';
import { ResizeHandleDirective } from './resize-handle.directive';

/**
 * A `StackItem` enriched with display flags the template + the
 * awaiting-priority callout consume. `mine` / `isOpponent` are derived from
 * `controllerId` vs the local seat; `label` is the friendliest available
 * name (card name → description → kind).
 */
export interface StackItemView extends StackItem {
  mine: boolean;
  isOpponent: boolean;
  controllerName: string | null;
  label: string;
}

// Effective card-scale ceiling on a phone: two seats + hands must fit a short
// landscape height. The user can still shrink further via the layout slider.
const MOBILE_CARD_SCALE = 0.6;

@Component({
  selector: 'app-board',
  standalone: true,
  // Card-scale CSS-var overrides (read from LayoutPrefsService.cardScale).
  //  * --majik-card-w/h (scaledCardW/H): the scaled base 100/140 — battlefield
  //    cards inherit these directly.
  //  * --majik-card-scale (raw multiplier): the zone overrides that pin their
  //    own absolute card size (opp face-down hand, self hand — see board.scss
  //    .arena-strip__hand / __hand--self) multiply their base px by THIS, so the
  //    slider scales hand cards too, not just the battlefield. Without it the
  //    zone overrides' absolute px would win and the hand wouldn't scale.
  host: {
    '[style.--majik-card-w.px]': 'scaledCardW()',
    '[style.--majik-card-h.px]': 'scaledCardH()',
    '[style.--majik-card-scale]': 'cardScale()',
  },
  imports: [
    CardViewComponent,
    PlayerHudComponent,
    ManaPoolRowComponent,
    PhaseBarComponent,
    ActionBarComponent,
    LayoutControlsComponent,
    CardContextMenuComponent,
    ManaColorPickerComponent,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    ZoneRailComponent,
    ZoneModalComponent,
    GameLogComponent,
    ResizeHandleDirective,
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
  // Each .arena-side is flex: 1 1 0 (equal half each). The inner
  // stack ABOVE the centerline is now SYMMETRIC: each side parks
  // HUD + mana + hand in a SINGLE .arena-strip (opp's hand is
  // face-down, shrunk via .arena-strip__hand in board.scss; self's
  // hand sits in .arena-strip__hand--self). One strip per side, so
  //
  //   opp .arena-strip height == self .arena-strip--self height
  //
  // Both .battlefield wrappers are flex: 1 1 0 inside their
  // arena-side, so equal strip footprint implies equal battlefield
  // height (one strip per side, equal ⇒ equal battlefields).
  //
  // Heights are co-located here (vs. board.scss) so they're loaded
  // in jsdom unit tests for the layout assertions in
  // board.component.spec.ts. Literal pixel values (vs. CSS vars)
  // since jsdom doesn't resolve var() through Angular's emulated
  // encapsulation. Math:
  //   strip-h = 116px (one strip per side, equal ⇒ equal battlefields)
  styles: [`
    :host {
      display: flex;
      flex: 1 1 0;
      min-height: 0;
      flex-direction: column;
    }
    .arena-side--foe .arena-strip,
    .arena-side--self > .arena-strip--self {
      flex: 0 0 116px;
      min-height: 116px;
      max-height: 116px;
      align-items: center;
    }
    // Self hand scrolls horizontally when it overflows; cards keep
    // their (medium) size rather than wrapping or being clipped. Card
    // sizing (--majik-card-w/h) + justify-content live in board.scss;
    // these three are co-located so the overflow assertion in
    // board.component.spec.ts can read them in jsdom (board.scss is not
    // loaded in the unit-test env). Keep both in sync.
    .arena-strip__hand--self {
      flex-wrap: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
    }
    // Cut-off fix: battlefield card rows scroll rather than clip. Mirrors
    // the overflow-y:auto in board.scss (.frontline / .backline__lands /
    // .backline__utility) — co-located here because global board.scss is
    // not loaded in the jsdom unit-test env. Keep both in sync.
    .frontline,
    .backline__lands,
    .backline__utility {
      overflow-y: auto;
    }
    .centerline-handle, .strip-handle {
      flex: 0 0 6px;
      cursor: row-resize;
      border-radius: 3px;
      background: var(--majik-line-faint, rgba(255,255,255,0.08));
      transition: background-color 150ms ease-out;
    }
    .centerline-handle:hover, .strip-handle:hover,
    .centerline-handle:focus-visible, .strip-handle:focus-visible {
      background: var(--majik-accent, rgba(202,167,90,0.6));
      outline: none;
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

            flex-grow ONLY is bound here (foeGrow/selfGrow, default 1.0 each);
            flex-shrink + flex-basis:0 come from the .arena-side "flex: 1 1 0"
            rule in board.scss. Don't convert that SCSS to a non-zero basis or
            the split ratio math (grow = ratio*2) breaks.
          -->
          <div class="arena-side arena-side--foe" [style.flex-grow]="foeGrow()">
            <!--
              CR 406.3 / 706.2 — opponent's off-battlefield zone rail
              (Library count + Graveyard + Exile). Docked to the outer
              (top-right) corner of their half so it doesn't crowd the
              battlefield. Graveyard / Exile are public, so clicking
              either browses the full zone in a modal.
            -->
            <app-zone-rail
              [player]="opponent()"
              ownerSide="opponent"
              (browse)="openZone('opponent', $event)" />
            <div class="arena-strip">
              <app-player-hud
                class="arena-strip__hud"
                [player]="opponent()"
                [active]="opponent()?.id === s.activePlayerId"
                [targetable]="isTargetable(opponent()?.id ?? '')"
                [dimmed]="isDimmed(opponent()?.id ?? '')"
                [selectedForTarget]="isSelectedForTarget(opponent()?.id ?? '')"
                (click)="onPlayerHudClick(opponent()!)"
                side="opponent"
                label="opponent" />
              <app-mana-pool-row class="arena-strip__mana" [player]="opponent()" />
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
                        [targetable]="isTargetable(c.instanceId)"
                        [dimmed]="isDimmed(c.instanceId)"
                        [selectedForTarget]="isSelectedForTarget(c.instanceId)"
                        (click)="onBoardCardClick(c)"
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
                        [targetable]="isTargetable(c.instanceId)"
                        [dimmed]="isDimmed(c.instanceId)"
                        [selectedForTarget]="isSelectedForTarget(c.instanceId)"
                        (click)="onBoardCardClick(c)"
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
                      [targetable]="isTargetable(c.instanceId)"
                      [dimmed]="isDimmed(c.instanceId)"
                      [selectedForTarget]="isSelectedForTarget(c.instanceId)"
                      (click)="onBoardCardClick(c)"
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
            Centerline drag handle (direct child of .board-arena, between
            the two arena-sides). Dragging it adjusts the opp/self split
            ratio; ArrowUp/ArrowDown nudge it. Plain quotes only in this
            comment (no backticks) so the inline template literal stays
            intact.
          -->
          <div
            class="centerline-handle"
            appResizeHandle
            aria-label="resize battlefield split"
            (resizeDelta)="onCenterlineResize($event)"
            (resizeEnd)="onCenterlineResizeEnd()"></div>

          <!--
            Self zone. Mirror of the opponent: frontline ON TOP (toward
            the centerline so creatures meet), backline ON BOTTOM —
            lands LEFT, utility RIGHT. ONE cdkDropList wraps the whole
            .battlefield so drag-from-hand resolves to onBattlefieldDrop
            regardless of which inner bucket the user releases over.
          -->
          <div class="arena-side arena-side--self" [style.flex-grow]="selfGrow()">
            <!--
              CR 406.3 / 706.2 — your off-battlefield zone rail (Library
              count + Graveyard + Exile). Docked to the outer (bottom-
              right) corner of your half, mirroring the opponent's rail.
              Graveyard / Exile click → browse modal.
            -->
            <app-zone-rail
              [player]="self()"
              ownerSide="self"
              (browse)="openZone('self', $event)" />
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
                      [targetable]="isTargetable(c.instanceId)"
                      [dimmed]="isDimmed(c.instanceId)"
                      [selectedForTarget]="isSelectedForTarget(c.instanceId)"
                      (click)="onBoardCardClick(c)"
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
                        [targetable]="isTargetable(c.instanceId)"
                        [dimmed]="isDimmed(c.instanceId)"
                        [selectedForTarget]="isSelectedForTarget(c.instanceId)"
                        (click)="onBoardCardClick(c)"
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
                        [targetable]="isTargetable(c.instanceId)"
                        [dimmed]="isDimmed(c.instanceId)"
                        [selectedForTarget]="isSelectedForTarget(c.instanceId)"
                        (click)="onBoardCardClick(c)"
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

            <!--
              Strip-edge drag handle (direct child of .arena-side--self,
              between the battlefield and the self strip). Dragging UP makes
              the hand strip taller. Plain quotes only here (no backticks).
            -->
            <div
              class="strip-handle"
              appResizeHandle
              aria-label="resize hand area"
              (resizeDelta)="onHandStripResize($event)"
              (resizeEnd)="onHandStripResizeEnd()"></div>

            <div class="arena-strip arena-strip--self"
              [style.flex-basis.px]="handStripPx()"
              [style.min-height.px]="handStripPx()"
              [style.max-height.px]="handStripPx()">
              <app-player-hud
                class="arena-strip__hud"
                [player]="self()"
                [active]="self()?.id === s.activePlayerId"
                [targetable]="isTargetable(self()?.id ?? '')"
                [dimmed]="isDimmed(self()?.id ?? '')"
                [selectedForTarget]="isSelectedForTarget(self()?.id ?? '')"
                (click)="onPlayerHudClick(self()!)"
                side="self"
                label="you" />
              <app-mana-pool-row class="arena-strip__mana" [player]="self()" />
              <div
                #selfHandList="cdkDropList"
                id="self-hand-droplist"
                class="hand-row arena-strip__hand arena-strip__hand--self"
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
            [class.stack-chip--opponent]="opponentObjectOnStack()"
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
                    [class.stack-item--opponent]="item.isOpponent"
                    [class.stack-item--mine]="item.mine"
                    [attr.data-stack-kind]="item.kind"
                    [attr.data-stack-controller]="item.isOpponent ? 'opponent' : (item.mine ? 'self' : null)"
                    animate.enter="stack-item-enter"
                    animate.leave="stack-item-leave">
                    <div class="stack-item__head flex items-center justify-between gap-2">
                      <span class="font-semibold">{{ item.label }}</span>
                      @if (i === 0) {
                        <span class="stack-item__badge">next</span>
                      }
                    </div>
                    <div class="stack-item__meta opacity-70">
                      @if (item.controllerName) {
                        <span [class.text-amber-300]="item.isOpponent">{{ item.controllerName }}</span>
                        <span class="opacity-50"> · </span>
                      }
                      <span>{{ item.kind }}</span>
                    </div>
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
                    [class.stack-item--opponent]="item.isOpponent"
                    [class.stack-item--mine]="item.mine"
                    [attr.data-stack-kind]="item.kind"
                    [attr.data-stack-controller]="item.isOpponent ? 'opponent' : (item.mine ? 'self' : null)">
                    <div class="font-semibold">{{ item.label }}</div>
                    <div class="opacity-70">{{ item.kind }}</div>
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

          <!--
            Full-game action log — collapsible left-edge drawer overlaying
            the board (closed by default; anchored left so it never collides
            with the right-anchored stack chip / zone rail). Reuses the
            SignalR event stream
            via GameStore.logEntries(); passing priority is never logged.
          -->
          <app-game-log
            [entries]="logEntries()"
            [selfIds]="selfPlayerIds()" />
        </div>

        <!--
          Prominent "a spell is on the stack and the engine is waiting on
          YOU" callout. Sits directly above the action bar so the cast (esp.
          the opponent's) is impossible to miss without expanding the stack.
          aria-live=assertive so screen readers announce a new cast the
          moment priority lands on the player. Rendered ONLY when there's a
          stack object AND we hold a genuine priority window (see
          stackPriorityCallout).
        -->
        @if (stackPriorityCallout(); as callout) {
          <div
            class="stack-callout"
            [class.stack-callout--opponent]="callout.opponent"
            role="status"
            aria-live="assertive"
            aria-atomic="true">
            <span class="stack-callout__pip" aria-hidden="true"></span>
            <span class="stack-callout__text">
              <span class="stack-callout__headline">{{ callout.headline }}</span>
              <span class="stack-callout__detail">{{ callout.detail }}</span>
            </span>
          </div>
        }

        <app-layout-controls />

        <app-action-bar
          [canPass]="canPass()"
          [currentPrompt]="currentPrompt()"
          (pass)="passClicked.emit()"
          (concede)="concedeClicked.emit()"
          (undoRequested)="undoClicked.emit()" />

        <app-card-context-menu
          [card]="activeContextCard()"
          [position]="activeContextPos()"
          [canTap]="loyaltyPickerMode() ? false : canTapActiveContext()"
          [abilitiesOnly]="loyaltyPickerMode()"
          [activatableAbilities]="activeMenuAbilities()"
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

        <!-- CR 406.3 / 706.2 — zone browse modal. Whichever side+zone was
             clicked drives kind / ownerName / cards via openedZone(). -->
        @if (openedZone(); as oz) {
          <app-zone-modal
            [kind]="oz.kind"
            [ownerName]="oz.ownerName"
            [cards]="oz.cards"
            (closed)="closeZone()" />
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

  /**
   * On-board click-to-select decision. Emitted on auto-submit (fixed-count
   * target/choice) and on combat confirm. Shapes mirror the overlay's
   * PromptDecision so match.ts routes it through the SAME
   * onPromptDecision()/translateDecision() path (no new translation).
   *   targets   → { kind: 'targets', targetInstanceIds }
   *   choice    → { kind: 'choice', selectedInstanceIds, choiceKind }
   *   attackers → { kind: 'attackers', attackers: [{ attackerInstanceId, defenderId }] }
   *   blockers  → { kind: 'blockers', blockers: [{ attackerInstanceId, blockerInstanceId }] }
   */
  readonly boardDecision = output<PromptDecision>();

  /**
   * Live combat-assignment relay for the SVG arrow overlay. Mirrors the
   * overlay's assignmentsChanged output so match.ts can feed liveAssignments
   * the same way whether the user is declaring via the board or the modal.
   */
  readonly assignmentsChanged = output<{
    kind: 'attackers' | 'blockers';
    attackers?: { attackerInstanceId: string; defenderId: string }[];
    blockers?: { attackerInstanceId: string; blockerInstanceId: string }[];
  }>();

  private readonly selection = inject(SelectionService);

  /** True while an on-board selection mode is active (any in-scope kind). */
  readonly inSelection = computed<boolean>(() => this.selection.mode() !== null);

  /** Legal/highlighted? targets/choice = candidate pool; combat = own creatures. */
  isTargetable(id: string): boolean {
    const m = this.selection.mode();
    if (!m) return false;
    if (m.kind === 'targets' || m.kind === 'choice') return m.candidateIds.has(id);
    if (m.kind === 'attackers') return this.ownCreatureIds().has(id);
    if (m.kind === 'blockers') {
      // Own untapped-or-sick creatures are blocker candidates; once a
      // blocker is pending, the attacking enemy creatures light up too.
      if (this.ownCreatureIds(true).has(id)) return true;
      return this.selection.pendingBlocker() != null && this.attackingIds().has(id);
    }
    return false;
  }

  isSelectedForTarget(id: string): boolean {
    const m = this.selection.mode();
    if (!m) return false;
    if (m.kind === 'attackers' || m.kind === 'targets' || m.kind === 'choice') {
      return this.selection.selected().includes(id);
    }
    if (m.kind === 'blockers') {
      if (this.selection.pendingBlocker() === id) return true;
      return this.selection.blockPairs().some(p => p.blockerInstanceId === id);
    }
    return false;
  }

  isDimmed(id: string): boolean {
    return this.inSelection() && !this.isTargetable(id) && !this.isSelectedForTarget(id);
  }

  /** Own creatures eligible to act. forBlock skips the summoning-sickness
   *  filter (sick creatures CAN block, CR 302.6) but always requires untapped. */
  private ownCreatureIds(forBlock = false): Set<string> {
    const s = this.state();
    const me = new Set(this.selfPlayerIds());
    const ids = new Set<string>();
    for (const p of s?.players ?? []) {
      if (!me.has(p.id)) continue;
      for (const c of p.battlefield.cards) {
        const isCreature = (c.types ?? []).some(t => t.toLowerCase().includes('creature'));
        if (!isCreature || c.tapped) continue;
        if (!forBlock && c.summoningSickness) continue;
        ids.add(c.instanceId);
      }
    }
    return ids;
  }

  /** Enemy creatures currently attacking (declared attackers are tapped). */
  private attackingIds(): Set<string> {
    const s = this.state();
    const me = new Set(this.selfPlayerIds());
    const ids = new Set<string>();
    for (const p of s?.players ?? []) {
      if (me.has(p.id)) continue;
      for (const c of p.battlefield.cards) {
        if (c.tapped && (c.types ?? []).some(t => t.toLowerCase().includes('creature'))) {
          ids.add(c.instanceId);
        }
      }
    }
    return ids;
  }

  /** A board card was clicked while a selection mode is active. */
  onBoardCardClick(card: { instanceId: string }): void {
    const m = this.selection.mode();
    if (!m) return;
    if (m.kind === 'targets' || m.kind === 'choice') {
      if (!m.candidateIds.has(card.instanceId)) return; // illegal — ignore
      this.selection.toggle(card.instanceId);
      this.maybeAutoSubmit(m);
      return;
    }
    if (m.kind === 'attackers') {
      if (!this.ownCreatureIds().has(card.instanceId)) return;
      this.selection.toggle(card.instanceId);
      this.emitAttackerLines();
      return;
    }
    if (m.kind === 'blockers') {
      const mine = this.ownCreatureIds(true); // untapped own creatures (sick OK)
      if (mine.has(card.instanceId)) {
        this.selection.setPendingBlocker(card.instanceId);
        return;
      }
      const pend = this.selection.pendingBlocker();
      if (pend && this.attackingIds().has(card.instanceId)) {
        this.selection.addBlockPair(pend, card.instanceId);
        this.emitBlockerLines();
      }
      return;
    }
  }

  /**
   * A player's HUD was clicked while a targets selection is active —
   * Lightning Bolt to the face. Mirrors onBoardCardClick's targets arm:
   * the player id rides in the SAME selection set and emits the SAME
   * { kind: 'targets', targetInstanceIds } decision (no new decision type).
   */
  onPlayerHudClick(player: { id: string } | null | undefined): void {
    if (!player) return;
    const m = this.selection.mode();
    if (!m || m.kind !== 'targets') return;
    if (!m.candidateIds.has(player.id)) return; // illegal target — ignore
    this.selection.toggle(player.id);
    this.maybeAutoSubmit(m);
  }

  private maybeAutoSubmit(m: SelectionMode): void {
    const n = this.selection.selected().length;
    // Fixed count (min === max) auto-submits the instant we hit max; a
    // single fixed target (min=max=1) therefore submits on one click.
    if (m.min === m.max && n === m.max) this.submitSelection(m);
  }

  private submitSelection(m: SelectionMode): void {
    const ids = this.selection.selected();
    if (m.kind === 'targets') {
      this.boardDecision.emit({ kind: 'targets', targetInstanceIds: ids });
    } else if (m.kind === 'choice') {
      this.boardDecision.emit({ kind: 'choice', selectedInstanceIds: ids, choiceKind: m.choiceKind });
    }
    this.selection.clear();
  }

  private emitAttackerLines(): void {
    const defenderId = this.opponent()?.id ?? '';
    this.assignmentsChanged.emit({
      kind: 'attackers',
      attackers: this.selection.selected().map(id => ({ attackerInstanceId: id, defenderId })),
    });
  }

  private emitBlockerLines(): void {
    this.assignmentsChanged.emit({ kind: 'blockers', blockers: this.selection.blockPairs() });
  }

  // Context-menu state. `activeContextCard` doubles as the visibility
  // flag — when null the menu hides. Position is the page coords of the
  // right-click event, clamped inside the viewport by the menu itself.
  readonly activeContextCard = signal<CardSnapshot | null>(null);
  readonly activeContextPos = signal<{ x: number; y: number } | null>(null);
  // Tracks which side's battlefield the active context card belongs to,
  // so the menu can hide Tap / Untap for opponent permanents.
  readonly activeContextOwner = signal<'self' | 'opponent' | null>(null);
  /**
   * True while the menu is open as the double-click-a-planeswalker LOYALTY
   * PICKER (a focused dropdown of the planeswalker's currently-usable
   * +N / −N abilities) rather than the right-click context menu. In this
   * mode the menu renders ONLY the ability list (no Tap / details /
   * scryfall) and the ability list is the loyalty-only projection. Reset
   * by closeContextMenu().
   */
  readonly loyaltyPickerMode = signal<boolean>(false);

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
    const loyalty = this.usableLoyaltyAbilities(card);
    return [...activated, ...loyalty];
  });

  /**
   * Abilities the OPEN menu should list. The right-click context menu shows
   * the full activated + loyalty mix (activeContextActivatableAbilities);
   * the double-click loyalty PICKER (loyaltyPickerMode) shows ONLY the
   * planeswalker's currently-usable loyalty abilities. Both share the same
   * gating helpers so the two entry points never disagree on legality.
   */
  readonly activeMenuAbilities = computed<ActivatableAbility[]>(() => {
    if (this.loyaltyPickerMode()) {
      const card = this.activeContextCard();
      return card ? this.usableLoyaltyAbilities(card) : [];
    }
    return this.activeContextActivatableAbilities();
  });

  /**
   * The planeswalker's currently-usable loyalty abilities (CR 606), as
   * menu-ready ActivatableAbility entries. Gated identically wherever
   * loyalty is surfaced:
   *   * the current prompt must advertise the loyalty-activation kind
   *     (sorcery-speed priority window — loyaltyActivationAllowed); AND
   *   * each −N ability must be affordable (current loyalty ≥ N).
   * Empty when the prompt doesn't allow loyalty activation or none are
   * affordable. Does NOT itself require the card be a planeswalker — the
   * loyalty-kind filter already excludes non-PW permanents (they have no
   * kind === 'Loyalty' abilities).
   */
  private usableLoyaltyAbilities(card: CardSnapshot): ActivatableAbility[] {
    if (!this.loyaltyActivationAllowed()) return [];
    return (card.abilities ?? [])
      .filter(a => a.kind === 'Loyalty' && a.id != null)
      .filter(a => this.loyaltyAbilityAffordable(card, a.description ?? ''))
      .map(a => ({ id: a.id!, description: a.description ?? '', kind: 'loyalty' as const }));
  }

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

  // CR 406.3 / 706.2 — currently-expanded off-battlefield zone (graveyard
  // or exile). Null = no modal open. Stores the owner side + zone kind so
  // openedZone() re-derives the live cards / name from the current game
  // state (cards moving into the zone while the modal is open appear
  // without re-clicking).
  private readonly openedZoneRef = signal<{ side: 'self' | 'opponent'; kind: ZoneKind } | null>(
    null,
  );
  readonly openedZone = computed<{
    kind: ZoneKind;
    ownerName: string;
    cards: CardSnapshot[];
  } | null>(() => {
    const ref = this.openedZoneRef();
    if (!ref) return null;
    const player = ref.side === 'self' ? this.self() : this.opponent();
    if (!player) return null;
    const cards = ref.kind === 'exile' ? player.exile.cards : player.graveyard.cards;
    return { kind: ref.kind, ownerName: player.name, cards };
  });

  openZone(side: 'self' | 'opponent', kind: ZoneKind): void {
    this.openedZoneRef.set({ side, kind });
  }

  closeZone(): void {
    this.openedZoneRef.set(null);
  }

  onContextMenu(event: MouseEvent, card: CardSnapshot, owner: 'self' | 'opponent'): void {
    event.preventDefault();
    // Pin the hover popover down — it was likely visible at right-click
    // time and the user just expressed intent to interact, not browse.
    this.popover.hide();
    this.loyaltyPickerMode.set(false);
    this.activeContextCard.set(card);
    this.activeContextPos.set({ x: event.clientX, y: event.clientY });
    this.activeContextOwner.set(owner);
  }

  closeContextMenu(): void {
    this.activeContextCard.set(null);
    this.activeContextPos.set(null);
    this.activeContextOwner.set(null);
    this.loyaltyPickerMode.set(false);
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
    // CR 606 — planeswalker loyalty picker. Double-clicking one of YOUR
    // planeswalkers opens a focused dropdown of its currently-usable
    // loyalty abilities (reusing the context-menu overlay in
    // loyaltyPickerMode). Takes precedence over the mana / activated paths
    // so a planeswalker that also has a (rare) activated ability still
    // gets the loyalty dropdown when loyalty is the live choice. When no
    // loyalty ability is usable right now (wrong priority window, or every
    // −N unaffordable) we fall through to the activated-ability path below
    // (and ultimately a no-op) rather than opening an empty menu. Note: not
    // gated on `tapped` for the loyalty path — planeswalkers don't tap to
    // activate loyalty (CR 606.3).
    if (isPlaneswalker(card) && this.usableLoyaltyAbilities(card).length > 0) {
      this.openLoyaltyPicker(card);
      return;
    }
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

  /**
   * Open the loyalty-ability picker dropdown for a self-owned
   * planeswalker, anchored at the card's on-screen position (falling back
   * to the viewport origin when the DOM node isn't found — e.g. in unit
   * tests, or if the bucket hasn't rendered yet). Reuses the context-menu
   * overlay in loyaltyPickerMode so the rendered list is the loyalty-only
   * projection with no Tap / details / scryfall rows.
   */
  private openLoyaltyPicker(card: CardSnapshot): void {
    this.popover.hide();
    const grid = this.boardGridEl?.nativeElement;
    const el = grid?.querySelector(
      `.arena-side--self .battlefield [data-card-id="${card.instanceId}"]`,
    ) as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    // Anchor near the card's top-right so the menu drops alongside it.
    const pos = rect ? { x: rect.right, y: rect.top } : { x: 0, y: 0 };
    this.loyaltyPickerMode.set(true);
    this.activeContextOwner.set('self');
    this.activeContextCard.set(card);
    this.activeContextPos.set(pos);
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

  private readonly layoutPrefs = inject(LayoutPrefsService);
  private readonly viewport = inject(ViewportService);

  // Base card geometry (matches tokens.scss / board.scss :root).
  private readonly baseCardW = 100;
  private readonly baseCardH = 140;

  readonly scaledCardW = computed(() => Math.round(this.baseCardW * this.layoutPrefs.cardScale()));
  readonly scaledCardH = computed(() => Math.round(this.baseCardH * this.layoutPrefs.cardScale()));
  // Raw multiplier exposed as --majik-card-scale so the absolute-sized hand /
  // opp-hand zone overrides (board.scss) can multiply their base px and scale
  // along with the slider. Public so the host binding type-checks.
  readonly cardScale = computed(() =>
    this.viewport.isMobileBoard()
      ? Math.min(this.layoutPrefs.cardScale(), MOBILE_CARD_SCALE)
      : this.layoutPrefs.cardScale(),
  );
  readonly foeGrow = computed(() => this.layoutPrefs.oppSelfRatio() * 2);
  readonly selfGrow = computed(() => (1 - this.layoutPrefs.oppSelfRatio()) * 2);
  // Effective self-strip height = the user's chosen handStripPx, but never
  // shorter than the (scaled) hand cards need — otherwise a high card-scale
  // would clip the hand against a fixed strip (overflow-y:hidden). The medium
  // self-hand card is 112px tall (board.scss .arena-strip__hand--self); +4px
  // matches the strip's slack so at default scale (112+4=116) this equals the
  // default handStripPx and the Phase-1 footprint stays exactly 116. The
  // user's value remains the floor; dragging the strip taller still works.
  private readonly selfHandCardH = 112;
  readonly handStripPx = computed(() =>
    Math.max(
      this.layoutPrefs.handStripPx(),
      Math.round(this.selfHandCardH * this.layoutPrefs.cardScale()) + 4,
    ),
  );

  // Drag-resize bases: captured on the first delta of a gesture so the
  // cumulative delta from the handle applies against a stable start value
  // (avoids drift from re-reading the just-mutated pref each move).
  private centerlineBase: number | null = null;
  private stripBase: number | null = null;

  onCenterlineResize(deltaY: number): void {
    const h = this.boardGridEl?.nativeElement.getBoundingClientRect().height || 800;
    this.centerlineBase ??= this.layoutPrefs.oppSelfRatio();
    this.layoutPrefs.setOppSelfRatio(this.centerlineBase + deltaY / h);
  }
  onCenterlineResizeEnd(): void { this.centerlineBase = null; }

  onHandStripResize(deltaY: number): void {
    // Dragging UP (negative deltaY) makes the strip TALLER.
    this.stripBase ??= this.layoutPrefs.handStripPx();
    this.layoutPrefs.setHandStripPx(this.stripBase - deltaY);
  }
  onHandStripResizeEnd(): void { this.stripBase = null; }

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

  // Full-game action log feed for the right-edge drawer. Public alias of
  // the store signal so the template can bind it (gameStore is private).
  readonly logEntries = this.gameStore.logEntries;

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

    // Clear any manual stack-expand override once the stack empties, so the
    // NEXT object added to the stack re-triggers the auto-expand rule (a
    // user who collapsed an earlier stack still gets the loud auto-open for
    // a brand-new cast).
    effect(() => {
      const empty = (this.state()?.stack.length ?? 0) === 0;
      if (empty && this.stackExpandOverride() !== null) {
        this.stackExpandOverride.set(null);
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
   * Manual user override for the stack-chip expand state. `null` = "no
   * explicit choice, follow the auto rule"; `true`/`false` = the user
   * clicked the toggle and we honour their pick until the stack empties.
   *
   * The auto rule (see `stackExpanded`) AUTO-EXPANDS the chip whenever the
   * stack is non-empty so a freshly-cast spell is never hidden behind a
   * collapsed chip — the whole point of this slice. When the stack is
   * empty the chip collapses to reclaim battlefield space.
   */
  private readonly stackExpandOverride = signal<boolean | null>(null);

  readonly stackExpanded = computed<boolean>(() => {
    const override = this.stackExpandOverride();
    if (override !== null) return override;
    // Auto: open while there's anything on the stack, collapsed otherwise.
    return (this.state()?.stack.length ?? 0) > 0;
  });

  toggleStack(): void {
    // Flip relative to the currently-displayed state and pin it as an
    // explicit override so the auto rule doesn't immediately undo it.
    this.stackExpandOverride.set(!this.stackExpanded());
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
  readonly reversedStack = computed<StackItemView[]>(() => {
    const s = this.state();
    if (!s) return [];
    const meId = this.self()?.id ?? null;
    const opp = this.opponent();
    const byId = new Map(s.players.map(p => [p.id, p.name]));
    // Render newest-first; carry whose-object + a friendly label so the
    // template (and the callout) can mark the opponent's spells and print
    // a readable name without re-deriving any of this per binding.
    return s.stack
      .slice()
      .reverse()
      .map(item => {
        const mine = item.controllerId != null && item.controllerId === meId;
        const isOpponent =
          item.controllerId != null && item.controllerId !== meId;
        const controllerName = item.controllerId
          ? (byId.get(item.controllerId) ?? (isOpponent ? opp?.name : null) ?? null)
          : null;
        return {
          ...item,
          mine,
          isOpponent,
          controllerName,
          // Spells carry a real card name; abilities fall back to their
          // description, then the bare kind.
          label: item.cardName ?? item.description ?? item.kind,
        } satisfies StackItemView;
      });
  });

  // Top of the stack = next object to resolve (newest-first projection's
  // first entry). Drives the callout's "Opponent cast X" headline.
  readonly topOfStack = computed<StackItemView | null>(
    () => this.reversedStack()[0] ?? null,
  );

  // Does the stack hold ANY object the opponent controls? Used to colour
  // the chip + raise the louder "respond or pass" callout.
  readonly opponentObjectOnStack = computed<boolean>(() =>
    this.reversedStack().some(i => i.isOpponent),
  );

  /**
   * View-model for the prominent "a spell is on the stack and the engine is
   * waiting on YOU" callout rendered just above the action bar.
   *
   * Non-null ONLY when BOTH hold:
   *   1. there's at least one object on the stack, AND
   *   2. the engine is awaiting THIS viewer in a genuine priority window
   *      (match.ts only forwards `currentPrompt` for the local seat, and we
   *      additionally require it advertise PassPriorityCommand — reusing the
   *      same gate as the Pass button, PR #123).
   *
   * Empty stack, opponent's window, or a non-priority sub-prompt (target /
   * surveil / mulligan) → null, so the callout never nags spuriously.
   */
  readonly stackPriorityCallout = computed<{
    headline: string;
    detail: string;
    opponent: boolean;
    count: number;
  } | null>(() => {
    if (!this.canPass()) return null;
    const stack = this.reversedStack();
    if (stack.length === 0) return null;
    const top = stack[0];
    const opponent = this.opponentObjectOnStack();
    const verb = top.kind === 'Spell' ? 'cast' : 'put';
    const who = top.isOpponent
      ? (top.controllerName ?? 'Opponent')
      : 'You';
    const headline = top.isOpponent
      ? `${who} ${verb} ${top.label}`
      : `${top.label} on the stack`;
    const detail =
      stack.length > 1
        ? `${stack.length} on the stack — respond or pass`
        : 'Respond or pass priority';
    return { headline, detail, opponent, count: stack.length };
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
