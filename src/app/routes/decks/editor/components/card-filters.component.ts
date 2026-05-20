import { Component, computed, inject } from '@angular/core';
import { CardSearchStore } from '../../../../core/card/card-search.store';

const COLOR_CHIPS = [
  { code: 'W', label: 'W' },
  { code: 'U', label: 'U' },
  { code: 'B', label: 'B' },
  { code: 'R', label: 'R' },
  { code: 'G', label: 'G' },
  { code: 'C', label: 'C' },
];

const TYPE_CHIPS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Planeswalker'];

const CMC_CHIPS: { value: number; label: string }[] = [
  { value: 0, label: '0' }, { value: 1, label: '1' }, { value: 2, label: '2' },
  { value: 3, label: '3' }, { value: 4, label: '4' }, { value: 5, label: '5' },
  { value: 6, label: '6' }, { value: 7, label: '7+' },
];

@Component({
  selector: 'app-card-filters',
  standalone: true,
  template: `
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-1">
        <span class="majik-micro mr-2">Color</span>
        @for (c of colors; track c.code) {
          <button type="button"
                  [attr.data-color]="c.code"
                  class="rounded border px-2 py-0.5 text-xs"
                  [class.border-amber-400]="isOn('colors', c.code)"
                  [class.text-amber-300]="isOn('colors', c.code)"
                  [class.border-white\/20]="!isOn('colors', c.code)"
                  (click)="toggle('colors', c.code)">{{ c.label }}</button>
        }
      </div>
      <div class="flex flex-wrap items-center gap-1">
        <span class="majik-micro mr-2">Type</span>
        @for (t of types; track t) {
          <button type="button"
                  [attr.data-type]="t"
                  class="rounded border px-2 py-0.5 text-xs"
                  [class.border-amber-400]="isOn('types', t)"
                  [class.text-amber-300]="isOn('types', t)"
                  [class.border-white\/20]="!isOn('types', t)"
                  (click)="toggle('types', t)">{{ t }}</button>
        }
      </div>
      <div class="flex flex-wrap items-center gap-1">
        <span class="majik-micro mr-2">CMC</span>
        @for (b of cmcs; track b.value) {
          <button type="button"
                  [attr.data-cmc]="b.value"
                  class="rounded border px-2 py-0.5 text-xs"
                  [class.border-amber-400]="isOnCmc(b.value)"
                  [class.text-amber-300]="isOnCmc(b.value)"
                  [class.border-white\/20]="!isOnCmc(b.value)"
                  (click)="toggleCmc(b.value)">{{ b.label }}</button>
        }
        @if (anyActive()) {
          <button type="button" data-action="clear"
                  class="ml-2 rounded border border-[color:var(--majik-line)] px-2 py-0.5 text-xs hover:border-red-400 hover:text-red-300"
                  (click)="clear()">Clear</button>
        }
      </div>
    </div>
  `,
})
export class CardFiltersComponent {
  readonly store = inject(CardSearchStore);
  readonly colors = COLOR_CHIPS;
  readonly types = TYPE_CHIPS;
  readonly cmcs = CMC_CHIPS;

  readonly anyActive = computed(() => {
    const f = this.store.filters();
    return (f.colors?.length ?? 0) + (f.types?.length ?? 0) + (f.cmc?.length ?? 0) > 0;
  });

  isOn(key: 'colors' | 'types', value: string): boolean {
    return (this.store.filters()[key] ?? []).includes(value);
  }

  isOnCmc(value: number): boolean {
    return (this.store.filters().cmc ?? []).includes(value);
  }

  toggle(key: 'colors' | 'types', value: string): void {
    const current = this.store.filters()[key] ?? [];
    const next = current.includes(value) ? current.filter(x => x !== value) : [...current, value];
    this.store.setFilters({ ...this.store.filters(), [key]: next });
  }

  toggleCmc(value: number): void {
    const current = this.store.filters().cmc ?? [];
    const next = current.includes(value) ? current.filter(x => x !== value) : [...current, value];
    this.store.setFilters({ ...this.store.filters(), cmc: next });
  }

  clear(): void {
    this.store.setFilters({});
  }
}
