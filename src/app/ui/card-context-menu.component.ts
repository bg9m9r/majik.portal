import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { CardSnapshot } from '../core/match/match.types';

/**
 * Right-click context menu surfaced over a card. The card-view host
 * captures the `(contextmenu)` event, calls `preventDefault()`, and
 * passes the page coords + the clicked card to this overlay.
 *
 * Available actions are emitted to the parent; this component stays
 * presentational and doesn't know about the game store or popover. The
 * parent decides which actions are legal for the clicked card — pass
 * `canTap=false` (the default for opponent permanents and non-battlefield
 * zones) to hide the tap entry.
 *
 * Outside-click and Escape both dismiss. The menu is mounted as a fixed-
 * position container positioned at the click coords; on render the
 * component clamps inside the viewport so a click in the bottom-right
 * corner doesn't slip past the edge.
 */
export type CardContextMenuAction = 'tap' | 'details' | 'scryfall';

/**
 * Activatable ability descriptor passed to the context menu by the
 * parent. The menu stays presentational — it doesn't know about the
 * game store or the engine's AbilityDto shape. The parent
 * (BoardComponent) filters the snapshot's `abilities[]` to entries
 * with `kind === 'Activated'` and a non-null `id`, and only passes
 * them for self-owned battlefield permanents.
 */
export interface ActivatableAbility {
  id: string;
  description: string;
  // Which engine command this entry maps to. 'activated' (default) →
  // ActivateAbilityCommand; 'loyalty' → ActivateLoyaltyAbilityCommand
  // (CR 606 planeswalker loyalty ability). The parent routes on this so
  // one menu list can offer both ability families. Absent = 'activated'
  // for back-compat with existing callers.
  kind?: 'activated' | 'loyalty';
}

@Component({
  selector: 'app-card-context-menu',
  standalone: true,
  template: `
    @if (card() && position(); as p) {
      <ul
        role="menu"
        class="fixed z-50 min-w-[12rem] overflow-hidden rounded border border-[color:var(--majik-line)] bg-[color:var(--majik-bg)] py-1 text-sm shadow-[var(--shadow-modal)]"
        [style.left.px]="clamped().left"
        [style.top.px]="clamped().top">
        @if (canTap()) {
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1.5 text-left hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              (click)="emit('tap')">
              Tap / Untap
            </button>
          </li>
        }
        @for (a of activatableAbilities(); track a.id) {
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1.5 text-left hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              (click)="emitActivate(a)">
              {{ a.description ? 'Activate ' + a.description : 'Activate ability' }}
            </button>
          </li>
        }
        @if (!abilitiesOnly()) {
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1.5 text-left hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              (click)="emit('details')">
              View details
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1.5 text-left hover:bg-white/10 focus:bg-white/10 focus:outline-none"
              (click)="emit('scryfall')">
              Open on Scryfall
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class CardContextMenuComponent {
  /** Card that was right-clicked. `null` hides the menu. */
  readonly card = input<CardSnapshot | null>(null);
  /** Page coords of the click. `null` hides the menu. */
  readonly position = input<{ x: number; y: number } | null>(null);
  /**
   * Show the Tap / Untap entry. The parent passes `true` only for the
   * viewer's own battlefield permanents — opponent permanents and the
   * hand / stack views get details + scryfall only.
   */
  readonly canTap = input<boolean>(false);
  /**
   * Activatable abilities legal to fire on the clicked card. Parent
   * (BoardComponent) supplies one entry per ability with `kind ===
   * 'Activated'` and a non-null `id`, only for self-owned battlefield
   * permanents. Empty array hides the Activate entries entirely.
   */
  readonly activatableAbilities = input<ActivatableAbility[]>([]);
  /**
   * When true the menu renders ONLY the ability list (no Tap, no View
   * details, no Open on Scryfall) — a focused "pick an ability" dropdown.
   * Used by the double-click-a-planeswalker → loyalty-ability picker, which
   * reuses this same overlay but wants just the (+N / −N) choices. Defaults
   * to false so the right-click context menu keeps its full action set.
   */
  readonly abilitiesOnly = input<boolean>(false);

  readonly closed = output<void>();
  readonly action = output<CardContextMenuAction>();
  /**
   * Emitted with the full ability descriptor when the user clicks one of
   * the "Activate …" entries. The parent routes on `kind` to translate
   * into either an ActivateAbilityCommand ('activated') or an
   * ActivateLoyaltyAbilityCommand ('loyalty') on the engine.
   */
  readonly activateAbilityRequested = output<ActivatableAbility>();

  private readonly host = inject(ElementRef<HTMLElement>);

  // Rough menu footprint used to keep the rendered list on screen. The
  // actual element auto-sizes; these constants are just enough to clamp
  // the top-left anchor so corner clicks don't render off-viewport.
  private static readonly MENU_W = 192;
  private static readonly MENU_H_MAX = 132; // 3 buttons * ~44px
  private static readonly MARGIN = 4;

  readonly clamped = computed<{ left: number; top: number }>(() => {
    const p = this.position();
    if (!p) return { left: 0, top: 0 };
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const m = CardContextMenuComponent.MARGIN;
    let left = p.x;
    let top = p.y;
    if (left + CardContextMenuComponent.MENU_W > vw - m) {
      left = Math.max(m, vw - m - CardContextMenuComponent.MENU_W);
    }
    if (top + CardContextMenuComponent.MENU_H_MAX > vh - m) {
      top = Math.max(m, vh - m - CardContextMenuComponent.MENU_H_MAX);
    }
    return { left, top };
  });

  emit(a: CardContextMenuAction): void {
    this.action.emit(a);
    this.closed.emit();
  }

  /**
   * Fires the activate output with the ability descriptor and closes the
   * menu. Mirrors `emit()` — each click is one beat.
   */
  emitActivate(ability: ActivatableAbility): void {
    this.activateAbilityRequested.emit(ability);
    this.closed.emit();
  }

  /**
   * Any click outside the menu collapses it. The board's
   * `(contextmenu)` handler re-opens immediately for a fresh card
   * click, so a single re-trigger feels like the menu "moved" rather
   * than closed-then-reopened.
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.card()) return;
    const root = this.host.nativeElement;
    if (root && root.contains(event.target as Node)) return;
    this.closed.emit();
  }

  /** Escape closes — keyboard parity for the menu. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.card()) return;
    this.closed.emit();
  }
}
