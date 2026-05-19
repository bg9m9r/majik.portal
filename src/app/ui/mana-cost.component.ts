import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-mana-cost',
  standalone: true,
  template: `
    <span class="font-mono text-xs tracking-tight">
      @for (sym of symbols(); track $index) {
        <span class="mr-0.5 inline-block rounded bg-black/40 px-1">{{ sym }}</span>
      }
    </span>
  `
})
export class ManaCostComponent {
  readonly cost = input<string>('');

  readonly symbols = computed(() => {
    const raw = this.cost();
    if (!raw) return [];
    return Array.from(raw.matchAll(/\{[^}]+\}/g)).map(m => m[0].slice(1, -1));
  });
}
