import { Component, ElementRef, computed, effect, inject, input } from '@angular/core';
import { Card } from '../core/card/card.types';
import { ScryfallImageCache } from '../core/card/scryfall-image-cache.service';
import { CardPopoverService } from './card-popover.service';

@Component({
  selector: 'app-card-tile',
  standalone: true,
  template: `
    <div #host
         class="relative overflow-hidden rounded-[6px] border border-[color:var(--majik-line)] bg-[color:var(--majik-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] hover:border-[color:var(--majik-accent)]"
         [style.width.px]="width()"
         [style.height.px]="height()"
         [attr.aria-label]="name()"
         (mouseenter)="onHover()"
         (mouseleave)="onLeave()">
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
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

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

  onHover(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => {
      const c = this.card();
      if (!c) return;
      const rect = (this.host.nativeElement.firstElementChild as HTMLElement | null)?.getBoundingClientRect()
                    ?? this.host.nativeElement.getBoundingClientRect();
      this.popover.show(c, rect);
    }, 200);
  }

  onLeave(): void {
    if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
    this.popover.hide();
  }
}
