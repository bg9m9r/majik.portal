import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { NgClass } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';
import { Card } from '../../../../core/card/card.types';

@Component({
  selector: 'app-zone-editor',
  standalone: true,
  imports: [CdkDropList, CdkDrag, NgClass],
  template: `
    <section class="flex flex-col gap-3">
      <h2 class="majik-h3 opacity-60">Editor</h2>

      <div role="tablist" class="flex gap-2">
        <button type="button" role="tab"
                class="rounded border px-3 py-1 text-xs uppercase tracking-wider"
                [ngClass]="store.activeZone() === 'main'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-white/20'"
                (click)="store.setActiveZone('main')">
          MAIN {{ store.mainCount() }}
        </button>
        <button type="button" role="tab"
                class="rounded border px-3 py-1 text-xs uppercase tracking-wider"
                [ngClass]="store.activeZone() === 'side'
                  ? 'border-amber-400 text-amber-300'
                  : 'border-white/20'"
                (click)="store.setActiveZone('side')">
          SIDE {{ store.sideCount() }}
        </button>
      </div>

      <ul id="zone-drop"
          cdkDropList
          [cdkDropListData]="entries()"
          (cdkDropListDropped)="onDropped($event)"
          class="flex flex-col gap-1 rounded border border-dashed border-[color:var(--majik-line)] p-2 min-h-[300px]">
        @if (entries().length === 0) {
          <li class="text-xs opacity-50 self-center">— drop cards here —</li>
        }
        @for (e of entries(); track e.name) {
          <li cdkDrag [cdkDragData]="e.name"
              class="flex items-center justify-between rounded border border-[color:var(--majik-line-faint)] px-2 py-1 text-sm">
            <span class="font-mono">×{{ e.count }}</span>
            <span class="flex-1 truncate px-2">{{ e.name }}</span>
            <span class="flex gap-1">
              <button type="button" class="rounded border border-[color:var(--majik-line)] px-2 hover:border-[color:var(--majik-accent)]"
                      (click)="store.dec(e.name)" [attr.aria-label]="'Decrement ' + e.name">-</button>
              <button type="button" class="rounded border border-[color:var(--majik-line)] px-2 hover:border-[color:var(--majik-accent)]"
                      (click)="store.inc(e.name)" [attr.aria-label]="'Increment ' + e.name">+</button>
              <button type="button" class="rounded border border-red-400/50 px-2 text-red-300 hover:bg-red-950/30"
                      (click)="store.remove(e.name)" [attr.aria-label]="'Remove ' + e.name">×</button>
            </span>
          </li>
        }
      </ul>
    </section>
  `,
})
export class ZoneEditorComponent {
  readonly store = inject(DeckEditorStore);
  readonly entries = computed(() =>
    this.store.activeZone() === 'main' ? this.store.mainboard() : this.store.sideboard()
  );

  onDropped(event: { item: { data: unknown } }): void {
    const data = event.item.data;
    if (typeof data === 'string') {
      // Already-in-zone reorder; no-op
      return;
    }
    const card = data as Card;
    if (card && typeof card === 'object' && 'name' in card) {
      this.store.add(card.name);
    }
  }
}
