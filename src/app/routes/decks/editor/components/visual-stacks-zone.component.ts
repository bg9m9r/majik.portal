import { CdkDropList } from '@angular/cdk/drag-drop';
import {
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CardSearchStore } from '../../../../core/card/card-search.store';
import { Card } from '../../../../core/card/card.types';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';
import { DeckCardEntry } from '../../../../core/deck/deck.types';
import { CardTileComponent } from '../../../../ui/card-tile.component';

type CmcBucket = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7+' | 'Land' | 'Other';

const CMC_ORDER: CmcBucket[] = ['0', '1', '2', '3', '4', '5', '6', '7+', 'Land', 'Other'];

const COLUMN_LABELS: Record<CmcBucket, string> = {
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7+': '7+',
  Land: 'Lands',
  Other: 'Other',
};

interface StackEntry {
  name: string;
  count: number;
  card: Card | null;
  cmc: number;
}

interface Slot {
  key: string;
  name: string;
  card: Card | null;
  showCount: number;
}

interface Column {
  type: CmcBucket;
  label: string;
  total: number;
  entries: StackEntry[];
  slots: Slot[];
}

function bucketFor(card: Card | null | undefined): CmcBucket {
  if (!card) return 'Other';
  if (card.types.includes('Land')) return 'Land';
  const cmc = card.cmc ?? 0;
  if (cmc <= 0) return '0';
  if (cmc >= 7) return '7+';
  return String(Math.floor(cmc)) as CmcBucket;
}

@Component({
  selector: 'app-visual-stacks-zone',
  standalone: true,
  imports: [CdkDropList, CardTileComponent],
  template: `
    <div #host
         id="zone-drop"
         cdkDropList
         [cdkDropListData]="rawEntries()"
         (cdkDropListDropped)="onDropped($event)"
         class="flex min-h-[420px] gap-3 overflow-x-auto rounded border border-dashed border-[color:var(--majik-line)] p-3">
      @if (rawEntries().length === 0) {
        <span class="self-center text-xs opacity-50">— drop cards here —</span>
      }
      @for (col of columns(); track col.type) {
        <section class="flex shrink-0 flex-col gap-2"
                 [style.width.px]="tileWidth()"
                 [attr.data-column]="col.type">
          <header class="flex items-center justify-between border-b border-[color:var(--majik-line-faint)] pb-1">
            <span class="text-[11px] uppercase tracking-wider opacity-70">{{ col.label }}</span>
            <span class="font-mono text-[11px] text-amber-300/80">{{ col.total }}</span>
          </header>
          <div class="relative" [style.height.px]="columnHeight(col.slots.length)">
            @for (slot of col.slots; track slot.key; let i = $index) {
              <div class="group/slot absolute left-0 hover:z-50"
                   [attr.data-entry]="slot.name"
                   [style.top.px]="i * stackOffset()"
                   [style.z-index]="i + 1">
                <app-card-tile [name]="slot.name"
                               [card]="slot.card"
                               [count]="slot.showCount"
                               [width]="tileWidth()"
                               [height]="tileHeight()" />
                <span class="pointer-events-none absolute right-1 top-1 hidden flex-row gap-1 group-hover/slot:flex"
                      style="z-index: 60;">
                  <button type="button"
                          class="pointer-events-auto rounded border border-[color:var(--majik-line)] bg-black/80 px-1.5 text-xs hover:border-[color:var(--majik-accent)]"
                          (click)="store.dec(slot.name)"
                          [attr.aria-label]="'Decrement ' + slot.name">-</button>
                  <button type="button"
                          class="pointer-events-auto rounded border border-[color:var(--majik-line)] bg-black/80 px-1.5 text-xs hover:border-[color:var(--majik-accent)]"
                          (click)="store.inc(slot.name)"
                          [attr.aria-label]="'Increment ' + slot.name">+</button>
                  <button type="button"
                          class="pointer-events-auto rounded border border-red-400/50 bg-black/80 px-1.5 text-xs text-red-300 hover:bg-red-950/30"
                          (click)="store.remove(slot.name)"
                          [attr.aria-label]="'Remove ' + slot.name">×</button>
                </span>
              </div>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class VisualStacksZoneComponent {
  readonly store = inject(DeckEditorStore);
  private readonly cards = inject(CardSearchStore);
  private readonly platformId = inject(PLATFORM_ID);

  private static readonly MIN_TILE_WIDTH = 110;
  private static readonly MAX_TILE_WIDTH = 220;
  // Magic card aspect ratio (height / width) ≈ 88 / 63.
  private static readonly ASPECT = 88 / 63;
  // Gap between columns (matches Tailwind gap-3 = 0.75rem ≈ 12px).
  private static readonly COL_GAP = 12;
  // Container left+right padding (p-3 = 0.75rem each).
  private static readonly CONTAINER_PADDING = 24;

  private readonly hostRef = viewChild<ElementRef<HTMLElement>>('host');
  private readonly containerWidth = signal(0);

  readonly tileWidth = computed(() => {
    const cols = this.columns().length;
    const w = this.containerWidth();
    if (!w || !cols) return 140;
    const available = w - VisualStacksZoneComponent.CONTAINER_PADDING -
      VisualStacksZoneComponent.COL_GAP * Math.max(0, cols - 1);
    const per = Math.floor(available / cols);
    return Math.max(
      VisualStacksZoneComponent.MIN_TILE_WIDTH,
      Math.min(VisualStacksZoneComponent.MAX_TILE_WIDTH, per),
    );
  });

  readonly tileHeight = computed(() => Math.round(this.tileWidth() * VisualStacksZoneComponent.ASPECT));
  readonly stackOffset = computed(() => Math.max(20, Math.round(this.tileHeight() * 0.16)));

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    if (typeof ResizeObserver === 'undefined') return;
    effect((onCleanup) => {
      const host = this.hostRef();
      if (!host) return;
      const el = host.nativeElement;
      this.containerWidth.set(el.clientWidth);
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          this.containerWidth.set(e.contentRect.width);
        }
      });
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
  }

  readonly rawEntries = computed<DeckCardEntry[]>(() =>
    this.store.activeZone() === 'main' ? this.store.mainboard() : this.store.sideboard()
  );

  readonly columns = computed<Column[]>(() => {
    const byName = this.cards.byName();
    const groups = new Map<CmcBucket, StackEntry[]>();

    for (const entry of this.rawEntries()) {
      const card = byName[entry.name] ?? null;
      const bucket = bucketFor(card);
      const list = groups.get(bucket) ?? [];
      list.push({
        name: entry.name,
        count: entry.count,
        card,
        cmc: card?.cmc ?? 0,
      });
      groups.set(bucket, list);
    }

    const out: Column[] = [];
    for (const type of CMC_ORDER) {
      const list = groups.get(type);
      if (!list || list.length === 0) continue;
      list.sort((a, b) => (a.cmc - b.cmc) || a.name.localeCompare(b.name));
      const total = list.reduce((sum, e) => sum + e.count, 0);
      const slots: Slot[] = [];
      for (const e of list) {
        for (let i = 0; i < e.count; i++) {
          slots.push({
            key: `${e.name}-${i}`,
            name: e.name,
            card: e.card,
            showCount: i === e.count - 1 ? e.count : 0,
          });
        }
      }
      out.push({ type, label: COLUMN_LABELS[type], total, entries: list, slots });
    }
    return out;
  });

  columnHeight(slotCount: number): number {
    if (slotCount <= 0) return this.tileHeight();
    return this.tileHeight() + (slotCount - 1) * this.stackOffset();
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
