import { CdkDropList } from '@angular/cdk/drag-drop';
import { Component, computed, inject } from '@angular/core';
import { CardSearchStore } from '../../../../core/card/card-search.store';
import { Card } from '../../../../core/card/card.types';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';
import { DeckCardEntry } from '../../../../core/deck/deck.types';
import { CardTileComponent } from '../../../../ui/card-tile.component';

// Priority order; a multi-type card slots into the first match.
const TYPE_PRIORITY = [
  'Planeswalker',
  'Creature',
  'Sorcery',
  'Instant',
  'Artifact',
  'Enchantment',
  'Land',
] as const;
type ColumnType = (typeof TYPE_PRIORITY)[number] | 'Other';

const COLUMN_LABELS: Record<ColumnType, string> = {
  Planeswalker: 'Planeswalkers',
  Creature: 'Creatures',
  Sorcery: 'Sorceries',
  Instant: 'Instants',
  Artifact: 'Artifacts',
  Enchantment: 'Enchantments',
  Land: 'Lands',
  Other: 'Other',
};

interface StackEntry {
  name: string;
  count: number;
  card: Card | null;
  cmc: number;
}

interface Column {
  type: ColumnType;
  label: string;
  total: number;
  entries: StackEntry[];
}

function primaryType(card: Card | null | undefined): ColumnType {
  if (!card) return 'Other';
  for (const t of TYPE_PRIORITY) {
    if (card.types.includes(t)) return t;
  }
  return 'Other';
}

@Component({
  selector: 'app-visual-stacks-zone',
  standalone: true,
  imports: [CdkDropList, CardTileComponent],
  template: `
    <div id="zone-drop"
         cdkDropList
         [cdkDropListData]="rawEntries()"
         (cdkDropListDropped)="onDropped($event)"
         class="flex min-h-[420px] gap-4 overflow-x-auto rounded border border-dashed border-[color:var(--majik-line)] p-3">
      @if (rawEntries().length === 0) {
        <span class="self-center text-xs opacity-50">— drop cards here —</span>
      }
      @for (col of columns(); track col.type) {
        <section class="flex w-[120px] shrink-0 flex-col gap-2"
                 [attr.data-column]="col.type">
          <header class="flex items-center justify-between border-b border-[color:var(--majik-line-faint)] pb-1">
            <span class="text-[11px] uppercase tracking-wider opacity-70">{{ col.label }}</span>
            <span class="font-mono text-[11px] text-amber-300/80">{{ col.total }}</span>
          </header>
          <ul class="flex flex-col gap-3">
            @for (entry of col.entries; track entry.name) {
              <li class="group relative"
                  [attr.data-entry]="entry.name"
                  [style.height.px]="entryHeight(entry.count)">
                @for (i of stackIndexes(entry.count); track i) {
                  <div class="absolute left-0 w-[100px]"
                       [style.top.px]="i * 32"
                       [style.z-index]="i + 1">
                    <app-card-tile [name]="entry.name"
                                   [count]="i === entry.count - 1 ? entry.count : 0"
                                   [card]="entry.card" />
                  </div>
                }
                <span class="pointer-events-none absolute right-1 hidden gap-1 group-hover:flex"
                      [style.top.px]="(entry.count - 1) * 32 + 4"
                      [style.z-index]="entry.count + 10">
                  <button type="button"
                          class="pointer-events-auto rounded border border-[color:var(--majik-line)] bg-black/80 px-1.5 text-xs hover:border-[color:var(--majik-accent)]"
                          (click)="store.dec(entry.name)"
                          [attr.aria-label]="'Decrement ' + entry.name">-</button>
                  <button type="button"
                          class="pointer-events-auto rounded border border-[color:var(--majik-line)] bg-black/80 px-1.5 text-xs hover:border-[color:var(--majik-accent)]"
                          (click)="store.inc(entry.name)"
                          [attr.aria-label]="'Increment ' + entry.name">+</button>
                  <button type="button"
                          class="pointer-events-auto rounded border border-red-400/50 bg-black/80 px-1.5 text-xs text-red-300 hover:bg-red-950/30"
                          (click)="store.remove(entry.name)"
                          [attr.aria-label]="'Remove ' + entry.name">×</button>
                </span>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class VisualStacksZoneComponent {
  readonly store = inject(DeckEditorStore);
  private readonly cards = inject(CardSearchStore);

  // Vertical offset between stacked cards (Moxfield-style title peek).
  private static readonly STACK_OFFSET = 32;
  // Card tile height.
  private static readonly TILE_HEIGHT = 140;

  readonly rawEntries = computed<DeckCardEntry[]>(() =>
    this.store.activeZone() === 'main' ? this.store.mainboard() : this.store.sideboard()
  );

  readonly columns = computed<Column[]>(() => {
    const byName = this.cards.byName();
    const groups = new Map<ColumnType, StackEntry[]>();

    for (const entry of this.rawEntries()) {
      const card = byName[entry.name] ?? null;
      const type = primaryType(card);
      const list = groups.get(type) ?? [];
      list.push({
        name: entry.name,
        count: entry.count,
        card,
        cmc: card?.cmc ?? 0,
      });
      groups.set(type, list);
    }

    const order: ColumnType[] = [...TYPE_PRIORITY, 'Other'];
    const out: Column[] = [];
    for (const type of order) {
      const list = groups.get(type);
      if (!list || list.length === 0) continue;
      list.sort((a, b) => (a.cmc - b.cmc) || a.name.localeCompare(b.name));
      const total = list.reduce((sum, e) => sum + e.count, 0);
      out.push({ type, label: COLUMN_LABELS[type], total, entries: list });
    }
    return out;
  });

  stackIndexes(count: number): number[] {
    const n = Math.max(1, count);
    return Array.from({ length: n }, (_, i) => i);
  }

  entryHeight(count: number): number {
    const n = Math.max(1, count);
    return VisualStacksZoneComponent.TILE_HEIGHT + (n - 1) * VisualStacksZoneComponent.STACK_OFFSET;
  }

  onDropped(event: { item: { data: unknown } }): void {
    const data = event.item.data;
    if (typeof data === 'string') {
      // Already-in-zone reorder; no-op.
      return;
    }
    const card = data as Card;
    if (card && typeof card === 'object' && 'name' in card) {
      this.store.add(card.name);
    }
  }
}
