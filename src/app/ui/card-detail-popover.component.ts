import { Component, computed, inject } from '@angular/core';
import { CardPopoverService } from './card-popover.service';

@Component({
  selector: 'app-card-detail-popover',
  standalone: true,
  template: `
    @if (popover.current(); as p) {
      <div
        role="tooltip"
        class="pointer-events-none fixed z-50 w-[280px] rounded border border-[color:var(--majik-line)] bg-[color:var(--majik-bg)] p-3 shadow-[var(--shadow-modal)]"
        [style.left.px]="position().left"
        [style.top.px]="position().top">
        <img class="mb-2 w-full rounded"
             [src]="imageUrl(p.card.name)"
             [alt]="p.card.name"
             referrerpolicy="no-referrer" />
        <div class="flex flex-col gap-1">
          <p class="majik-h3 opacity-80">{{ p.card.name }}</p>
          @if (p.card.manaCost) {
            <p class="font-mono text-xs opacity-70">{{ p.card.manaCost }}</p>
          }
          <p class="text-xs opacity-70">{{ p.card.types.join(' ') }}</p>
          @if (p.card.oracleText) {
            <p class="whitespace-pre-line text-xs opacity-80">{{ p.card.oracleText }}</p>
          }
          @if (p.card.power !== null && p.card.toughness !== null) {
            <p class="font-mono text-xs opacity-70">{{ p.card.power }}/{{ p.card.toughness }}</p>
          }
        </div>
      </div>
    }
  `,
})
export class CardDetailPopoverComponent {
  readonly popover = inject(CardPopoverService);

  readonly position = computed(() => {
    const cur = this.popover.current();
    if (!cur) return { left: 0, top: 0 };
    const r = cur.rect;
    const popoverWidth = 280;
    const margin = 8;
    let left = r.right + margin;
    if (typeof window !== 'undefined' && left + popoverWidth > window.innerWidth) {
      left = r.left - popoverWidth - margin;
    }
    return { left, top: r.top };
  });

  imageUrl(name: string): string {
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name).replace(/%20/g, '+')}&format=image&version=normal`;
  }
}
