import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-card-tile',
  standalone: true,
  template: `
    <div class="relative h-[140px] w-[100px] overflow-hidden rounded-[6px] border border-[color:var(--majik-line)] bg-[color:var(--majik-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] hover:border-[color:var(--majik-accent)]"
         [attr.aria-label]="name()">
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
  readonly imageUrl = computed(() =>
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(this.name()).replace(/%20/g, '+')}&format=image&version=small`);
}
