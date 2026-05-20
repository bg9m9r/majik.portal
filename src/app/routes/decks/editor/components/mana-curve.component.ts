import { Component, computed, inject } from '@angular/core';
import { CardSearchStore } from '../../../../core/card/card-search.store';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';

@Component({
  selector: 'app-mana-curve',
  standalone: true,
  template: `
    <div class="flex flex-col gap-1">
      <span class="majik-micro">Mana curve</span>
      <div class="flex items-end gap-1" style="height: 80px;">
        @for (b of buckets(); track b.label) {
          <div class="flex flex-1 flex-col items-center justify-end gap-0.5">
            <span class="text-[10px] opacity-50">{{ b.count }}</span>
            <div class="w-full rounded-sm bg-[color:var(--majik-accent)]"
                 [style.height.%]="b.height"
                 [attr.aria-label]="b.label + ' CMC: ' + b.count + ' cards'"></div>
            <span class="text-[10px] opacity-70">{{ b.label }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class ManaCurveComponent {
  private readonly editor = inject(DeckEditorStore);
  private readonly cards = inject(CardSearchStore);

  readonly buckets = computed(() => {
    const byName = this.cards.byName();
    const counts = new Array(8).fill(0);
    for (const entry of this.editor.mainboard()) {
      const card = byName[entry.name];
      if (!card) continue;
      const isLand = card.types.some(t => t === 'Land');
      if (isLand) continue;
      const cmc = card.cmc ?? 0;
      const bucket = cmc >= 7 ? 7 : cmc;
      counts[bucket] += entry.count;
    }
    const max = Math.max(1, ...counts);
    return counts.map((count, i) => ({
      label: i === 7 ? '7+' : String(i),
      count,
      height: (count / max) * 100,
    }));
  });
}
