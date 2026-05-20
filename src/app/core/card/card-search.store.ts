import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap, debounceTime, distinctUntilChanged, take } from 'rxjs';
import { CardApi } from './card.api';
import { Card } from './card.types';

type CardSearchState = {
  query: string;
  results: Card[];
  cache: Record<string, Card>;
  nextOffset: number;
  loading: boolean;
  error: 'search-failed' | null;
};

const initial: CardSearchState = {
  query: '',
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
    setQuery: rxMethod<string>(pipe(
      debounceTime(250),
      distinctUntilChanged(),
      tap(query => patchState(store, { query, loading: true, error: null, results: [], nextOffset: 0 })),
      switchMap(query => api.search(query, 50, 0).pipe(
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
        return api.search(store.query(), 50, offset).pipe(
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
