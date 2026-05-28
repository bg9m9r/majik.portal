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
import { CardViewComponent, snapshotToCard } from '../../../ui/card-view.component';
import { PlayerHudComponent } from '../../../ui/player-hud.component';
import { ManaPoolRowComponent } from '../../../ui/mana-pool-row.component';
import { PhaseBarComponent } from '../../../ui/phase-bar.component';
import { ActionBarComponent } from './action-bar.component';
import {
  CardContextMenuAction,
  CardContextMenuComponent,
} from '../../../ui/card-context-menu.component';
import { CardPopoverService } from '../../../ui/card-popover.service';
import { ManaColorPickerComponent } from '../../../ui/mana-color-picker.component';

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
  ],
  // Layout overview (Arena-style):
  //
  //   ┌─────────────────────────────────────────────────────────────────┐
  //   │ phase-bar                                                       │
  //   ├─────────────────────────────────────────────────────────────────┤
  //   │ opp HUD  +  mana row                                            │
  //   │ opp hand-row (face-down, slim)                                  │
  //   │ ───── opponent battlefield-row (full width) ───────────         │
  //   │                                                                 │
  //   │ ───── self battlefield-row (full width) ───────────             │
  //   │ self hand-row (drag-drop, full width)                           │
  //   │ self mana row  +  HUD                                           │
  //   ├─────────────────────────────────────────────────────────────────┤
  //   │ action-bar                                                      │
  //   └─────────────────────────────────────────────────────────────────┘
  //
  //   Stack panel floats on the right edge (absolute, top-right of the
  //   board area). Compact when empty (just header), expanded when
  //   populated. Doesn't push battlefield content around as the stack
  //   grows / shrinks — Arena keeps the table layout stable.
  //
  // The two whose-turn ambient rims now sit on the .battlefield-row
  // elements directly (back from PR #33's frame-container approach) so
  // the full-width rows read as the obvious "table half" boundaries.
  // HUDs keep their own active rim from PR #32 so the friend/foe cue
  // is reinforced top + bottom.
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
          <!-- Opponent zone: HUD + mana row on top, slim face-down hand
               below, full-width battlefield at the bottom (closest to
               the dividing line in the middle of the table). -->
          <div class="arena-side arena-side--foe">
            <div class="flex items-center gap-3">
              <app-player-hud
                class="flex-1"
                [player]="opponent()"
                [active]="opponent()?.id === s.activePlayerId"
                side="opponent"
                label="opponent" />
              <app-mana-pool-row [player]="opponent()" />
            </div>

            <!--
              Opponent hand (face-down). Server emits the opponent's hand
              as N "(hidden)" placeholder cards via the per-viewer mask in
              StateSnapshotter (CR 706) — we render one face-down card per
              placeholder so the count is visually obvious without leaking
              names.
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

            <div
              class="battlefield-row"
              [class.battlefield-row--active-foe]="opponent()?.id === s.activePlayerId"
              [class.battlefield-row--inactive]="opponent()?.id !== s.activePlayerId">
              @for (c of opponent()?.battlefield?.cards ?? []; track c.instanceId) {
                <app-card-view
                  [snapshot]="c"
                  [attr.data-card-id]="c.instanceId"
                  zone="battlefield"
                  animate.enter="zone-enter-from-top"
                  animate.leave="zone-leave-down"
                  (contextmenu)="onContextMenu($event, c, 'opponent')" />
              } @empty {
                <span class="opacity-30">— opponent battlefield empty —</span>
              }
            </div>
          </div>

          <!-- Self zone: full-width battlefield closest to the middle,
               hand below, mana + HUD at the bottom (closest to the
               action bar). Mirror of the opponent side. -->
          <div class="arena-side arena-side--self">
            <div
              #selfBattlefieldList="cdkDropList"
              id="self-battlefield-droplist"
              class="battlefield-row"
              [class.battlefield-row--active-self]="self()?.id === s.activePlayerId"
              [class.battlefield-row--inactive]="self()?.id !== s.activePlayerId"
              cdkDropList
              cdkDropListSortingDisabled
              [cdkDropListConnectedTo]="['self-hand-droplist']"
              (cdkDropListDropped)="onBattlefieldDrop($event)">
              @for (c of self()?.battlefield?.cards ?? []; track c.instanceId) {
                <app-card-view
                  [snapshot]="c"
                  [attr.data-card-id]="c.instanceId"
                  zone="battlefield"
                  animate.enter="zone-enter-from-bottom"
                  animate.leave="zone-leave-up"
                  (contextmenu)="onContextMenu($event, c, 'self')"
                  (cardDoubleClick)="onSelfBattlefieldDoubleClick($event)" />
              } @empty {
                <span class="opacity-30">— your battlefield empty —</span>
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

            <div class="flex items-center gap-3">
              <app-player-hud
                class="flex-1"
                [player]="self()"
                [active]="self()?.id === s.activePlayerId"
                side="self"
                label="you" />
              <app-mana-pool-row [player]="self()" />
            </div>
          </div>

          <!--
            Stack floats on the right edge (absolute, doesn't push the
            table around). Header always visible; items only render when
            populated. Newest at the top — resolution reads top → bottom.
          -->
          <aside
            class="stack-floating"
            [class.stack-floating--populated]="s.stack.length > 0"
            aria-label="stack">
            <h3 class="mb-1 text-[10px] uppercase tracking-wider opacity-60">
              Stack ({{ s.stack.length }})
            </h3>
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
          [canPass]="!!currentPrompt()"
          [currentPrompt]="currentPrompt()"
          (pass)="passClicked.emit()"
          (concede)="concedeClicked.emit()"
          (undoRequested)="undoClicked.emit()" />

        <app-card-context-menu
          [card]="activeContextCard()"
          [position]="activeContextPos()"
          [canTap]="activeContextOwner() === 'self'"
          (close)="closeContextMenu()"
          (action)="onContextAction($event)" />

        @if (manaPicker(); as mp) {
          <app-mana-color-picker
            [colors]="mp.colors"
            [anchorRect]="mp.anchorRect"
            (colorSelected)="onManaColorPicked($event)"
            (dismiss)="closeManaPicker()" />
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

  // Context-menu state. `activeContextCard` doubles as the visibility
  // flag — when null the menu hides. Position is the page coords of the
  // right-click event, clamped inside the viewport by the menu itself.
  readonly activeContextCard = signal<CardSnapshot | null>(null);
  readonly activeContextPos = signal<{ x: number; y: number } | null>(null);
  // Tracks which side's battlefield the active context card belongs to,
  // so the menu can hide Tap / Untap for opponent permanents.
  readonly activeContextOwner = signal<'self' | 'opponent' | null>(null);

  // Mana color-picker popover state. `manaPicker()` is non-null while
  // the chooser is visible; carries the card we're activating + its
  // anchor rect for positioning.
  readonly manaPicker = signal<{
    card: CardSnapshot;
    colors: string;
    anchorRect: DOMRect;
  } | null>(null);

  private readonly popover = inject(CardPopoverService);

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
        `.arena-side--self .battlefield-row [data-card-id="${card.instanceId}"]`
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
        const card = grid.querySelector(
          `.arena-side--self .battlefield-row [data-card-id="${a.attackerInstanceId}"]`
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
          `.arena-side--self .battlefield-row [data-card-id="${b.blockerInstanceId}"]`
        ) as HTMLElement | null;
        const attackerEl = grid.querySelector(
          `.arena-side--foe .battlefield-row [data-card-id="${b.attackerInstanceId}"]`
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
