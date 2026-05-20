import { Component, ElementRef, computed, inject, input } from '@angular/core';
import { Card } from '../core/card/card.types';
import { CardPopoverService } from './card-popover.service';

@Component({
  selector: 'app-card-tile',
  standalone: true,
  template: `
    <div #host
         class="relative h-[140px] w-[100px] overflow-hidden rounded-[6px] border border-[color:var(--majik-line)] bg-[color:var(--majik-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] hover:border-[color:var(--majik-accent)]"
         [attr.aria-label]="name()"
         (mouseenter)="onHover()"
         (mouseleave)="onLeave()">
      <img class="absolute inset-0 h-full w-full object-cover"
           [src]="imageUrl()"
           [alt]="name()"
           loading="lazy"
           referrerpolicy="no-referrer" />
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

  private readonly popover = inject(CardPopoverService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

  readonly imageUrl = computed(() =>
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(this.name()).replace(/%20/g, '+')}&format=image&version=small`);

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
