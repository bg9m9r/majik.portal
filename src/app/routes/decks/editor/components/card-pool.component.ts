import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CardSearchStore } from '../../../../core/card/card-search.store';
import { Card } from '../../../../core/card/card.types';
import { CardTileComponent } from '../../../../ui/card-tile.component';
import { CardFiltersComponent } from './card-filters.component';

@Component({
  selector: 'app-card-pool',
  standalone: true,
  imports: [CardTileComponent, CdkDrag, CdkDropList, FormsModule, CardFiltersComponent],
  template: `
    <section class="flex flex-col gap-3">
      <h2 class="majik-h3 opacity-60">Card pool</h2>

      <input type="search"
             class="rounded border border-[color:var(--majik-line)] bg-black/30 px-3 py-2 text-sm"
             placeholder="Search by name"
             [ngModel]="search.query()"
             (ngModelChange)="search.setQuery($event)" />

      <app-card-filters />

      @if (search.loading()) {
        <p class="text-xs opacity-50">Searching…</p>
      } @else if (search.error()) {
        <div class="flex flex-col gap-2">
          <p class="text-red-300/80 text-xs">Search failed.</p>
          <button type="button"
                  class="self-start rounded border border-[color:var(--majik-line)] px-2 py-1 text-xs"
                  (click)="search.retry()">Retry</button>
        </div>
      } @else if (search.results().length === 0 && search.query().trim()) {
        <p class="text-xs opacity-50">— no matches —</p>
      } @else {
        <ul cdkDropList
            [cdkDropListConnectedTo]="connectedDropLists()"
            [cdkDropListData]="search.results()"
            class="grid grid-cols-3 gap-2">
          @for (c of search.results(); track c.name) {
            <li cdkDrag [cdkDragData]="c">
              <button type="button"
                      class="w-full"
                      (click)="add.emit(c.name)"
                      [attr.aria-label]="'Add ' + c.name">
                <app-card-tile [name]="c.name" [count]="0" [card]="c" />
              </button>
            </li>
          }
        </ul>

        @if (search.hasMore()) {
          <button type="button"
                  class="self-start rounded border border-[color:var(--majik-line)] px-3 py-1 text-xs hover:border-[color:var(--majik-accent)]"
                  (click)="search.loadMore()">Load more</button>
        }
      }
    </section>
  `,
})
export class CardPoolComponent {
  readonly search = inject(CardSearchStore);
  readonly add = output<string>();
  readonly connectedDropLists = input<string[]>([]);
}
