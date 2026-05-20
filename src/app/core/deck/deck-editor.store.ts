import { computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { tapResponse } from '@ngrx/operators';
import { of, pipe, switchMap, tap } from 'rxjs';
import { CardSearchStore } from '../card/card-search.store';
import { ToastService } from '../../ui/toast.service';
import { DeckApi } from './deck.api';
import { DecksStore } from './deck.store';
import { validateDeck } from './deck-validator';
import { Deck, DeckCardEntry, DeckError } from './deck.types';

type Zone = 'main' | 'side';

type EditorState = {
  id: string | null;
  name: string;
  mainboard: DeckCardEntry[];
  sideboard: DeckCardEntry[];
  activeZone: Zone;
  initial: { name: string; mainboard: DeckCardEntry[]; sideboard: DeckCardEntry[] } | null;
  saving: boolean;
  error: DeckError | null;
};

const blank: EditorState = {
  id: null,
  name: '',
  mainboard: [],
  sideboard: [],
  activeZone: 'main',
  initial: { name: '', mainboard: [], sideboard: [] },
  saving: false,
  error: null,
};

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }
function deepEq<T>(a: T, b: T): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function hydrateFrom(deck: Deck | null): Partial<EditorState> {
  if (!deck) return clone(blank);
  return {
    id: deck.id,
    name: deck.name,
    mainboard: clone(deck.mainboard),
    sideboard: clone(deck.sideboard),
    activeZone: 'main' as Zone,
    initial: { name: deck.name, mainboard: clone(deck.mainboard), sideboard: clone(deck.sideboard) },
    saving: false,
    error: null,
  };
}

function addCard(s: EditorState, name: string): Partial<EditorState> {
  const key = s.activeZone === 'main' ? 'mainboard' : 'sideboard';
  const list = s[key];
  const existing = list.find(e => e.name === name);
  const next = existing
    ? list.map(e => e.name === name ? { ...e, count: e.count + 1 } : e)
    : [...list, { name, count: 1 }];
  return { [key]: next } as Partial<EditorState>;
}

function adjust(s: EditorState, name: string, delta: number): Partial<EditorState> {
  const key = s.activeZone === 'main' ? 'mainboard' : 'sideboard';
  const list = s[key];
  const next = list
    .map(e => e.name === name ? { ...e, count: e.count + delta } : e)
    .filter(e => e.count > 0);
  return { [key]: next } as Partial<EditorState>;
}

function moveTo(s: EditorState, name: string, to: Zone): Partial<EditorState> {
  const fromKey = to === 'main' ? 'sideboard' : 'mainboard';
  const toKey = to === 'main' ? 'mainboard' : 'sideboard';
  const entry = s[fromKey].find(e => e.name === name);
  if (!entry) return {};
  const newFrom = s[fromKey].filter(e => e.name !== name);
  const target = s[toKey];
  const merged = target.find(e => e.name === name)
    ? target.map(e => e.name === name ? { ...e, count: e.count + entry.count } : e)
    : [...target, { ...entry }];
  return { [fromKey]: newFrom, [toKey]: merged } as Partial<EditorState>;
}

function currentDeckShape(s: { name: string; mainboard: DeckCardEntry[]; sideboard: DeckCardEntry[] }) {
  return { name: s.name, mainboard: s.mainboard, sideboard: s.sideboard };
}

function toRequestBody(s: { name: string; mainboard: DeckCardEntry[]; sideboard: DeckCardEntry[] }) {
  return { name: s.name.trim(), mainboard: s.mainboard, sideboard: s.sideboard };
}

function humanize(e: DeckError): string {
  switch (e.code) {
    case 'name-taken': return 'Deck name already in use.';
    case 'deck-cap-reached': return "You've hit 25 decks. Delete one to make room.";
    case 'deck-not-found': return 'Deck not found.';
    case 'mongo-not-configured': return 'Deck storage unavailable.';
    case 'network': return 'Connection lost. Retry.';
    default: return e.detail ?? 'Something went wrong.';
  }
}

export const DeckEditorStore = signalStore(
  withState<EditorState>(blank),
  withComputed((s) => {
    const cards = inject(CardSearchStore);
    return {
      mainCount: computed(() => s.mainboard().reduce((a, e) => a + e.count, 0)),
      sideCount: computed(() => s.sideboard().reduce((a, e) => a + e.count, 0)),
      dirty: computed(() => !deepEq(
        currentDeckShape({ name: s.name(), mainboard: s.mainboard(), sideboard: s.sideboard() }),
        s.initial()
      )),
      validation: computed(() => validateDeck(
        { name: s.name(), mainboard: s.mainboard(), sideboard: s.sideboard() },
        (name: string) => cards.byName()[name]
      )),
    };
  }),
  withMethods((store) => {
    const api = inject(DeckApi);
    const decks = inject(DecksStore);
    const router = inject(Router);
    const toast = inject(ToastService);
    return {
      loadFor: rxMethod<string | null>(pipe(
        switchMap(id => id ? api.get(id) : of(null as Deck | null)),
        tap(deck => patchState(store, hydrateFrom(deck))),
      )),
      add: (name: string) => patchState(store, s => addCard(s, name)),
      inc: (name: string) => patchState(store, s => adjust(s, name, +1)),
      dec: (name: string) => patchState(store, s => adjust(s, name, -1)),
      remove: (name: string) => patchState(store, s => {
        const key = s.activeZone === 'main' ? 'mainboard' : 'sideboard';
        return { [key]: s[key].filter(e => e.name !== name) } as Partial<EditorState>;
      }),
      move: (name: string, to: Zone) => patchState(store, s => moveTo(s, name, to)),
      rename: (name: string) => patchState(store, { name }),
      setActiveZone: (z: Zone) => patchState(store, { activeZone: z }),
      save: rxMethod<void>(pipe(
        tap(() => patchState(store, { saving: true, error: null })),
        switchMap(() => {
          const id = store.id();
          const body = toRequestBody({ name: store.name(), mainboard: store.mainboard(), sideboard: store.sideboard() });
          const op$ = id ? api.update(id, body) : api.create(body);
          return op$.pipe(
            tapResponse({
              next: (deck: Deck) => {
                decks.upsert(deck);
                patchState(store, hydrateFrom(deck));
                router.navigate(['/decks']);
              },
              error: (e: DeckError) => {
                patchState(store, { saving: false, error: e });
                if (e.code === 'name-taken' || e.code === 'deck-cap-reached') toast.error(humanize(e));
              },
            })
          );
        }),
      )),
    };
  })
);
