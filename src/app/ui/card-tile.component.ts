import { Component, ElementRef, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { Card } from '../core/card/card.types';
import { ScryfallImageCache } from '../core/card/scryfall-image-cache.service';
import { CardPopoverService } from './card-popover.service';

@Component({
  selector: 'app-card-tile',
  standalone: true,
  // The right-click menu styling is co-located here (not a global sheet) so
  // the jsdom unit env loads it. It mirrors CardContextMenuComponent's look
  // using the same --majik-* tokens, but stays inline so card-tile is fully
  // self-contained — its parents (card-pool, visual-stacks-zone) need no
  // changes to surface View details / Open on Scryfall.
  styles: [`
    .tile-menu {
      position: fixed;
      z-index: 50;
      min-width: 12rem;
      overflow: hidden;
      border-radius: 4px;
      border: 1px solid var(--majik-line);
      background: var(--majik-bg);
      padding-block: 0.25rem;
      font-size: 0.875rem;
      box-shadow: var(--shadow-modal);
    }
    .tile-menu button {
      display: block;
      width: 100%;
      padding: 0.375rem 0.75rem;
      text-align: left;
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
    }
    .tile-menu button:hover,
    .tile-menu button:focus {
      background: rgba(255, 255, 255, 0.1);
      outline: none;
    }
  `],
  template: `
    <div #host
         class="relative overflow-hidden rounded-[6px] border border-[color:var(--majik-line)] bg-[color:var(--majik-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] hover:border-[color:var(--majik-accent)]"
         [style.width.px]="width()"
         [style.height.px]="height()"
         [attr.aria-label]="name()"
         (contextmenu)="onContextMenu($event)">
      @if (imageUrl()) {
        <img class="absolute inset-0 h-full w-full object-cover"
             [src]="imageUrl()"
             [alt]="name()"
             loading="lazy"
             referrerpolicy="no-referrer" />
      } @else {
        <div data-image-placeholder
             class="absolute inset-0 flex items-center justify-center bg-[color:var(--majik-card)] px-2 text-center text-[10px] opacity-60">
          {{ name() }}
        </div>
      }
      @if (count() > 0) {
        <span data-count-badge
              class="absolute right-1 top-1 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
          {{ count() }}
        </span>
      }
    </div>
    @if (menuPos(); as p) {
      <ul #menu role="menu" class="tile-menu" [style.left.px]="p.x" [style.top.px]="p.y">
        <li role="none">
          <button type="button" role="menuitem" (click)="viewDetails()">
            View details
          </button>
        </li>
        <li role="none">
          <button type="button" role="menuitem" (click)="openScryfall()">
            Open on Scryfall
          </button>
        </li>
      </ul>
    }
  `,
})
export class CardTileComponent {
  readonly name = input.required<string>();
  readonly count = input<number>(0);
  readonly card = input<Card | null>(null);
  readonly width = input<number>(100);
  readonly height = input<number>(140);

  private readonly popover = inject(CardPopoverService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cache = inject(ScryfallImageCache);

  // Page coords of the open right-click menu; null when closed.
  readonly menuPos = signal<{ x: number; y: number } | null>(null);

  readonly imageUrl = computed(() => {
    // Re-read when the cache version bumps so newly-resolved URLs propagate.
    this.cache.version();
    return this.cache.get(this.name());
  });

  constructor() {
    effect(() => {
      const n = this.name();
      if (!n) return;
      // Touch version() so this effect re-runs after a batch resolves and may
      // be needed for cards whose name input changes mid-life.
      this.cache.version();
      if (!this.cache.get(n)) this.cache.request([n]);
    });
  }

  /**
   * Right-click affordance. Details are reachable ONLY here (hover popover
   * was removed). With a real Card we open the inline menu at the cursor;
   * without one (the in-match art pickers pass no card) we just suppress
   * the browser default and show nothing.
   */
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (!this.card()) {
      this.menuPos.set(null);
      return;
    }
    this.menuPos.set({ x: event.clientX, y: event.clientY });
  }

  /** Show the detail popover anchored on the tile, then close the menu. */
  viewDetails(): void {
    const c = this.card();
    if (c) {
      const rect = (this.host.nativeElement.firstElementChild as HTMLElement | null)?.getBoundingClientRect()
                    ?? this.host.nativeElement.getBoundingClientRect();
      this.popover.show(c, rect);
    }
    this.menuPos.set(null);
  }

  /** Open a Scryfall exact-name search in a new, opener-isolated tab. */
  openScryfall(): void {
    const c = this.card();
    if (c) {
      const url = `https://scryfall.com/search?q=${encodeURIComponent(`!"${c.name}"`)}`;
      window.open(url, '_blank', 'noopener');
    }
    this.menuPos.set(null);
  }

  /** Any click outside the open menu dismisses it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuPos()) return;
    const root = this.host.nativeElement;
    if (root && root.contains(event.target as Node)) return;
    this.menuPos.set(null);
  }

  /** Escape closes the menu — keyboard parity. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuPos()) this.menuPos.set(null);
  }
}
