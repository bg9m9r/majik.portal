import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { firstValueFrom, pipe, switchMap, tap, debounceTime, distinctUntilChanged, take } from 'rxjs';
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

      try {
        const cards = await firstValueFrom(api.getByName(missing));
        if (cards.length === 0) return;
        patchState(store, s => {
          const newCache = { ...s.cache };
          for (const c of cards) newCache[c.name] = c;
          return { cache: newCache };
        });
      } catch {
        // swallow; validator shows "unknown card" until next attempt
      }
    },
    setQuery: rxMethod<string>(pipe(
      // 400ms debounce — typical typing rate is ~150ms/char, so a user
      // pausing at the end of a word triggers exactly one search request.
      debounceTime(400),
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
