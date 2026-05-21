import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap, debounceTime, distinctUntilChanged, take } from 'rxjs';
import { CardApi } from './card.api';
import { Card, CardFilters } from './card.types';

type CardSearchState = {
  query: string;
  filters: CardFilters;
  results: Card[];
  cache: Record<string, Card>;
  nextOffset: number;
  loading: boolean;
  error: 'search-failed' | null;
};

const initial: CardSearchState = {
  query: '',
  filters: {},
  results: [],
  cache: {},
  nextOffset: 0,
  loading: false,
  error: null,
};

function mergeResults(prev: CardSearchState, cards: Card[], offset: number): Partial<CardSearchState> {
  const results = offset === 0 ? cards : [...prev.results, ...cards];
  const cache = { ...prev.cache };
  for (const c of cards) cache[c.name] = c;
  return {
    results,
    cache,
    nextOffset: offset + cards.length,
    loading: false,
    error: null,
  };
}

export const CardSearchStore = signalStore(
  { providedIn: 'root' },
  withState<CardSearchState>(initial),
  withComputed(({ cache }) => ({
    byName: computed(() => cache()),
  })),
  withMethods((store, api = inject(CardApi)) => ({
    async ensureCached(names: string[]): Promise<void> {
      const missing = Array.from(new Set(names)).filter(n => !store.cache()[n]);
      if (missing.length === 0) return;

      const found: Card[] = [];
      // Process in batches of 4 concurrent requests to avoid hammering the server.
      // /cards uses LIKE %q% so a search for "Forest" matches many cards.
      // Pull a wide page + filter for exact-name match client-side.
      for (let i = 0; i < missing.length; i += 4) {
        const batch = missing.slice(i, i + 4);
        const results = await Promise.all(
          batch.map(name =>
            new Promise<Card[]>(resolve => {
              api.search(name, 50, 0, {}, false).pipe(take(1)).subscribe({
                next: cards => {
                  const exact = cards.filter(c => c.name === name);
                  resolve(exact);
                },
                error: () => resolve([]),
              });
            })
          )
        );
        for (const cards of results) for (const c of cards) found.push(c);
      }

      if (found.length === 0) return;
      patchState(store, s => {
        const newCache = { ...s.cache };
        for (const c of found) newCache[c.name] = c;
        return { cache: newCache };
      });
    },
    setQuery: rxMethod<string>(pipe(
      debounceTime(250),
      distinctUntilChanged(),
      tap(query => patchState(store, { query, loading: true, error: null, results: [], nextOffset: 0 })),
      switchMap(query => api.search(query, 50, 0, store.filters()).pipe(
        take(1),
        tapResponse({
          next: cards => patchState(store, s => mergeResults(s, cards, 0)),
          error: () => patchState(store, { loading: false, error: 'search-failed' as const }),
        })
      ))
    )),
    setFilters: rxMethod<CardFilters>(pipe(
      tap(filters => patchState(store, { filters, loading: true, error: null, results: [], nextOffset: 0 })),
      switchMap(filters => api.search(store.query(), 50, 0, filters).pipe(
        take(1),
        tapResponse({
          next: cards => patchState(store, s => mergeResults(s, cards, 0)),
          error: () => patchState(store, { loading: false, error: 'search-failed' as const }),
        })
      ))
    )),
    loadMore: rxMethod<void>(pipe(
      switchMap(() => {
        const offset = store.nextOffset();
        return api.search(store.query(), 50, offset, store.filters()).pipe(
          take(1),
          tapResponse({
            next: cards => patchState(store, s => mergeResults(s, cards, offset)),
            error: () => patchState(store, { error: 'search-failed' as const }),
          })
        );
      })
    )),
  }))
);
