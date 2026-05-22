import { Component, computed, inject } from '@angular/core';
import { CardPopoverService } from './card-popover.service';

@Component({
  selector: 'app-card-detail-popover',
  standalone: true,
  template: `
    @if (popover.current(); as p) {
      <div
        role="tooltip"
        class="pointer-events-none fixed z-50 w-[280px] max-h-[calc(100vh-16px)] overflow-y-auto rounded border border-[color:var(--majik-line)] bg-[color:var(--majik-bg)] p-3 shadow-[var(--shadow-modal)]"
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
    // Approximate height — covers card image + meta. Used only to clamp the
    // popover inside the viewport; the actual element auto-sizes to content.
    const popoverHeight = 460;
    const margin = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
    let left = r.right + margin;
    if (left + popoverWidth > vw) {
      left = r.left - popoverWidth - margin;
    }
    if (left < margin) left = margin;
    let top = r.top;
    if (top + popoverHeight > vh - margin) {
      top = vh - margin - popoverHeight;
    }
    if (top < margin) top = margin;
    return { left, top };
  });

  imageUrl(name: string): string {
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name).replace(/%20/g, '+')}&format=image&version=normal`;
  }
}
