import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecksStore } from '../../../core/deck/deck.store';
import { Deck } from '../../../core/deck/deck.types';

@Component({
  selector: 'app-decks-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header class="flex items-center justify-between">
        <h1 class="majik-display-2">Decks</h1>
        <a routerLink="/decks/new"
           class="rounded border border-[color:var(--majik-accent)] px-3 py-1 text-sm text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10">
          Build a new deck
        </a>
      </header>

      @if (store.loading()) {
        <p class="opacity-60 text-sm">Loading…</p>
      } @else if (store.error(); as e) {
        <p class="text-red-300/80 text-sm">Failed: {{ e.code }}</p>
      } @else if (store.count() === 0) {
        <div class="flex flex-col items-center gap-4 py-12 text-center opacity-50">
          <p>— no decks yet —</p>
          <a routerLink="/decks/new"
             class="rounded border border-[color:var(--majik-accent)] px-4 py-2 text-[color:var(--majik-accent)] hover:bg-[color:var(--majik-accent)]/10">
            Build a new deck
          </a>
        </div>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (d of store.all(); track d.id) {
            <li class="flex items-center justify-between rounded border border-[color:var(--majik-line)] p-3">
              <div class="flex flex-col">
                <a [routerLink]="['/decks', d.id]" class="font-medium hover:text-[color:var(--majik-accent)]">{{ d.name }}</a>
                <span class="text-xs opacity-50">{{ totalCards(d) }} cards · updated {{ d.updatedAt }}</span>
              </div>
              <div class="flex gap-2">
                <a [routerLink]="['/decks', d.id]"
                   class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-sm hover:border-[color:var(--majik-accent)] hover:text-[color:var(--majik-accent)]">Edit</a>
                <button type="button" data-action="delete"
                        class="rounded border border-red-400/50 px-3 py-1 text-sm text-red-300 hover:bg-red-950/30"
                        (click)="confirmDelete(d)">Delete</button>
              </div>
            </li>
          }
        </ul>
      }
    </main>
  `,
})
export class DecksListComponent {
  readonly store = inject(DecksStore);

  totalCards(d: Deck): number {
    let total = 0;
    for (const e of d.mainboard) total += e.count;
    for (const e of d.sideboard) total += e.count;
    return total;
  }

  confirmDelete(d: Deck): void {
    if (confirm(`Delete "${d.name}"?`)) this.store.remove(d.id);
  }
}
