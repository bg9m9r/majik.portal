import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { pipe, switchMap, tap } from 'rxjs';
import { DeckApi } from './deck.api';
import { Deck, DeckError } from './deck.types';

type DecksState = {
  entities: Record<string, Deck>;
  ids: string[];
  loading: boolean;
  error: DeckError | null;
};

const initial: DecksState = { entities: {}, ids: [], loading: false, error: null };

function indexBy(decks: Deck[]): Partial<DecksState> {
  const entities: Record<string, Deck> = {};
  const ids: string[] = [];
  for (const deck of decks) {
    entities[deck.id] = deck;
    ids.push(deck.id);
  }
  return { entities, ids };
}

function mergeOne(s: DecksState, deck: Deck): Partial<DecksState> {
  const entities = { ...s.entities, [deck.id]: deck };
  const ids = s.ids.includes(deck.id) ? s.ids : [...s.ids, deck.id];
  return { entities, ids };
}

function removeOne(s: DecksState, id: string): Partial<DecksState> {
  const entities = { ...s.entities };
  delete entities[id];
  return { entities, ids: s.ids.filter(x => x !== id) };
}

export const DecksStore = signalStore(
  { providedIn: 'root' },
  withState<DecksState>(initial),
  withComputed(({ entities, ids }) => ({
    all: computed(() => ids().map(id => entities()[id])),
    count: computed(() => ids().length),
  })),
  withMethods((store, api = inject(DeckApi)) => ({
    load: rxMethod<void>(pipe(
      tap(() => patchState(store, { loading: true, error: null })),
      switchMap(() => api.list().pipe(
        tapResponse({
          next: decks => patchState(store, { ...indexBy(decks), loading: false }),
          error: (e: DeckError) => patchState(store, { loading: false, error: e }),
        })
      ))
    )),
    remove: rxMethod<string>(pipe(
      switchMap(id => api.delete(id).pipe(
        tapResponse({
          next: () => patchState(store, s => removeOne(s, id)),
          error: (e: DeckError) => patchState(store, { error: e }),
        })
      ))
    )),
    upsert: (deck: Deck) => patchState(store, s => mergeOne(s, deck)),
  })),
  withHooks({
    onInit(store) { store.load(); },
  })
);
