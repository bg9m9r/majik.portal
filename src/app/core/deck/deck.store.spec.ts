import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DeckApi } from './deck.api';
import { Deck } from './deck.types';
import { DecksStore } from './deck.store';

const d = (id: string, name = id): Deck => ({
  id, ownerSub: 'u', name, mainboard: [], sideboard: [], createdAt: 't', updatedAt: 't'
});

describe('DecksStore', () => {
  let api: { list: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  function init(over: Partial<typeof api> = {}) {
    api = {
      list: vi.fn(() => of([] as Deck[])),
      delete: vi.fn(() => of(void 0)),
      ...over,
    } as any;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: DeckApi, useValue: api }],
    });
    return TestBed.inject(DecksStore);
  }

  it('load on init populates state', () => {
    api = { list: vi.fn(() => of([d('a'), d('b')])), delete: vi.fn() } as any;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DeckApi, useValue: api }] });
    const store = TestBed.inject(DecksStore);
    expect(store.count()).toBe(2);
    expect(store.all().map(x => x.id)).toEqual(['a', 'b']);
    expect(store.loading()).toBe(false);
  });

  it('load error sets error state', () => {
    api = { list: vi.fn(() => throwError(() => ({ code: 'mongo-not-configured' as const }))), delete: vi.fn() } as any;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DeckApi, useValue: api }] });
    const store = TestBed.inject(DecksStore);
    expect(store.error()?.code).toBe('mongo-not-configured');
  });

  it('remove deletes via api + drops from state', () => {
    api = { list: vi.fn(() => of([d('a'), d('b')])), delete: vi.fn(() => of(void 0)) } as any;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DeckApi, useValue: api }] });
    const store = TestBed.inject(DecksStore);
    store.remove('a');
    expect(api.delete).toHaveBeenCalledWith('a');
    expect(store.all().map(x => x.id)).toEqual(['b']);
  });

  it('upsert merges new deck', () => {
    const store = init();
    store.upsert(d('a'));
    expect(store.all().map(x => x.id)).toEqual(['a']);
    store.upsert(d('a', 'renamed'));
    expect(store.all()[0].name).toBe('renamed');
  });
});
