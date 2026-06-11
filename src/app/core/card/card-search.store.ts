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
  // Whether another page might exist — gates the "Load more" button.
  hasMore: boolean;
  loading: boolean;
  // Number of in-flight ensureCached calls. Validator suppresses
  // "unknown card" errors while > 0.
  prefetching: number;
  error: 'search-failed' | null;
};

const PAGE_SIZE = 50;

const initial: CardSearchState = {
  query: '',
  filters: {},
  results: [],
  cache: {},
  nextOffset: 0,
  hasMore: false,
  loading: false,
  prefetching: 0,
  error: null,
};

function mergeResults(prev: CardSearchState, cards: Card[], offset: number): Partial<CardSearchState> {
  // Dedup by name: the server pages by offset, but if it re-sends rows we
  // already have (or ignores `offset` entirely), appending verbatim would
  // duplicate the list — and break the template's `track c.name`.
  const base = offset === 0 ? [] : prev.results;
  const seen = new Set(base.map(c => c.name));
  const fresh: Card[] = [];
  for (const c of cards) {
    if (!seen.has(c.name)) {
      seen.add(c.name);
      fresh.push(c);
    }
  }
  const cache = { ...prev.cache };
  for (const c of cards) cache[c.name] = c;
  return {
    results: [...base, ...fresh],
    cache,
    nextOffset: offset + cards.length,
    // A short page means the server ran out of matches. A full page that
    // contributed nothing new means pagination is not progressing — stop
    // offering "Load more" either way.
    hasMore: cards.length === PAGE_SIZE && fresh.length > 0,
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

      patchState(store, s => ({ prefetching: s.prefetching + 1 }));
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
      } finally {
        patchState(store, s => ({ prefetching: Math.max(0, s.prefetching - 1) }));
      }
    },
    setQuery: rxMethod<string>(pipe(
      // 400ms debounce — typical typing rate is ~150ms/char, so a user
      // pausing at the end of a word triggers exactly one search request.
      debounceTime(400),
      distinctUntilChanged(),
      tap(query => patchState(store, { query, loading: true, error: null, results: [], nextOffset: 0, hasMore: false })),
      switchMap(query => api.search(query, PAGE_SIZE, 0, store.filters()).pipe(
        take(1),
        tapResponse({
          next: cards => patchState(store, s => mergeResults(s, cards, 0)),
          error: () => patchState(store, { loading: false, error: 'search-failed' as const }),
        })
      ))
    )),
    setFilters: rxMethod<CardFilters>(pipe(
      tap(filters => patchState(store, { filters, loading: true, error: null, results: [], nextOffset: 0, hasMore: false })),
      switchMap(filters => api.search(store.query(), PAGE_SIZE, 0, filters).pipe(
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
        return api.search(store.query(), PAGE_SIZE, offset, store.filters()).pipe(
          take(1),
          tapResponse({
            next: cards => patchState(store, s => mergeResults(s, cards, offset)),
            error: () => patchState(store, { error: 'search-failed' as const }),
          })
        );
      })
    )),
    // Retry the current query + filters from offset 0. Unlike setQuery,
    // this bypasses the debounce + distinctUntilChanged — re-issuing the
    // SAME query after a failure (the common case behind the error-state
    // Retry button) would otherwise be swallowed by distinctUntilChanged
    // and never refire. Clears the error and sets loading immediately so
    // the UI flips out of the error state.
    retry: rxMethod<void>(pipe(
      tap(() => patchState(store, { loading: true, error: null, results: [], nextOffset: 0, hasMore: false })),
      switchMap(() => api.search(store.query(), PAGE_SIZE, 0, store.filters()).pipe(
        take(1),
        tapResponse({
          next: cards => patchState(store, s => mergeResults(s, cards, 0)),
          error: () => patchState(store, { loading: false, error: 'search-failed' as const }),
        })
      ))
    )),
  }))
);
