import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CardSearchStore } from '../card/card-search.store';
import { Card } from '../card/card.types';
import { DeckApi } from './deck.api';
import { DeckEditorStore } from './deck-editor.store';
import { DecksStore } from './deck.store';
import { Deck } from './deck.types';
import { ToastService } from '../../ui/toast.service';

const fixt = (over: Partial<Deck> = {}): Deck => ({
  id: 'd1', ownerSub: 'u', name: 'X', mainboard: [], sideboard: [],
  createdAt: 't', updatedAt: 't', ...over
});

const forest: Card = { name: 'Forest', manaCost: '', types: ['Basic', 'Land'], power: null, toughness: null, isImplemented: true };

function setup({ api, byName }: { api?: Partial<DeckApi>; byName?: Record<string, Card> } = {}) {
  const router = { navigate: vi.fn() };
  const decks = { upsert: vi.fn() };
  const toast = { error: vi.fn(), info: vi.fn() };
  const search = { byName: () => byName ?? {} };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      DeckEditorStore,
      { provide: DeckApi, useValue: { get: vi.fn(), create: vi.fn(() => of(fixt())), update: vi.fn(), ...api } },
      { provide: DecksStore, useValue: decks },
      { provide: CardSearchStore, useValue: search },
      { provide: Router, useValue: router },
      { provide: ToastService, useValue: toast },
    ],
  });
  return {
    store: TestBed.inject(DeckEditorStore),
    router, decks, toast, api: TestBed.inject(DeckApi),
  };
}

describe('DeckEditorStore', () => {
  it('loadFor(null) yields blank deck', () => {
    const { store } = setup();
    store.loadFor(null);
    expect(store.id()).toBeNull();
    expect(store.name()).toBe('');
    expect(store.mainboard()).toEqual([]);
  });

  it('loadFor(id) populates from api.get', () => {
    const api = { get: vi.fn(() => of(fixt({ name: 'Loaded', mainboard: [{ name: 'Forest', count: 4 }] }))) };
    const { store } = setup({ api });
    store.loadFor('d1');
    expect(store.id()).toBe('d1');
    expect(store.name()).toBe('Loaded');
    expect(store.mainboard()).toEqual([{ name: 'Forest', count: 4 }]);
  });

  it('add adds new entry with count 1', () => {
    const { store } = setup();
    store.add('Forest');
    expect(store.mainboard()).toEqual([{ name: 'Forest', count: 1 }]);
  });

  it('add increments existing entry', () => {
    const { store } = setup();
    store.add('Forest');
    store.add('Forest');
    expect(store.mainboard()).toEqual([{ name: 'Forest', count: 2 }]);
  });

  it('inc bumps count', () => {
    const { store } = setup();
    store.add('Forest');
    store.inc('Forest');
    expect(store.mainboard()[0].count).toBe(2);
  });

  it('dec drops count and removes at 0', () => {
    const { store } = setup();
    store.add('Forest');
    store.dec('Forest');
    expect(store.mainboard()).toEqual([]);
  });

  it('move shifts entry to opposite zone', () => {
    const { store } = setup();
    store.add('Forest');
    store.move('Forest', 'side');
    expect(store.mainboard()).toEqual([]);
    expect(store.sideboard()).toEqual([{ name: 'Forest', count: 1 }]);
  });

  it('dirty true after edit', () => {
    const { store } = setup();
    store.loadFor(null);
    expect(store.dirty()).toBe(false);
    store.rename('New name');
    expect(store.dirty()).toBe(true);
  });

  it('validation reflects current deck via cards cache', () => {
    const { store } = setup({ byName: { Forest: forest } });
    store.loadFor(null);
    store.rename('T');
    for (let i = 0; i < 60; i++) store.add('Forest');
    expect(store.validation().ok).toBe(true);
  });

  it('save success navigates + upserts list', async () => {
    const api = { create: vi.fn(() => of(fixt({ id: 'new1', name: 'Saved' }))) };
    const { store, router, decks } = setup({ api });
    store.loadFor(null);
    store.rename('Saved');
    store.save();
    await Promise.resolve();
    expect(decks.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' }));
    expect(router.navigate).toHaveBeenCalledWith(['/decks']);
  });

  it('save 400 surfaces validation, no nav', async () => {
    const api = { create: vi.fn(() => throwError(() => ({ code: 'invalid-deck' as const, validation: ['too small'] }))) };
    const { store, router } = setup({ api });
    store.loadFor(null);
    store.rename('X');
    store.save();
    await Promise.resolve();
    expect(store.error()?.code).toBe('invalid-deck');
    expect(store.error()?.validation).toEqual(['too small']);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('save 409 name-taken triggers toast', async () => {
    const api = { create: vi.fn(() => throwError(() => ({ code: 'name-taken' as const }))) };
    const { store, toast } = setup({ api });
    store.loadFor(null);
    store.rename('dup');
    store.save();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalled();
  });
});
