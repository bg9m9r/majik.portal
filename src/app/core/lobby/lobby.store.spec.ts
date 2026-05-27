import { TestBed } from '@angular/core/testing';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// Note: TestBed.flushEffects() is available in Angular 21 for signal-based stores
import { describe, expect, it, vi } from 'vitest';
import { MatchService } from '../match/match.service';
import { CreateMatchRequest, Match, MatchError } from '../match/match.types';
import { LobbyStore } from './lobby.store';

const m = (id: string): Match => ({
  id,
  state: 'Open',
  visibility: 'Public',
  format: 'constructed',
  clockMinutes: 25,
  creator: { sub: 'u1', handle: 'alice', deckId: 'd1' },
  opponent: null,
  roll: null,
  firstChoice: null,
  gameId: null,
  creatorMillisRemaining: 1500000,
  opponentMillisRemaining: 1500000,
  priorityHolderSub: null,
  priorityStartedAt: null,
  winnerSub: null,
  timeoutLoserSub: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
});

const req: CreateMatchRequest = {
  format: 'constructed',
  visibility: 'Public',
  deckId: 'd1',
  clockMinutes: 25,
};

/** Flush all pending microtasks (resolved Promises). */
async function flushMicrotasks(n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('LobbyStore', () => {
  let svc: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

  function init(over: Partial<typeof svc> = {}) {
    svc = {
      list: vi.fn(() => Promise.resolve({ ok: true, value: [] as Match[] })),
      create: vi.fn(() => Promise.resolve({ ok: true, value: m('new') })),
      ...over,
    } as any;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: MatchService, useValue: svc }],
    });
    return TestBed.inject(LobbyStore);
  }

  it('initial state has empty matches, not loading, no error', () => {
    const store = init();
    expect(store.matches()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.createError()).toBeNull();
  });

  it('load success populates matches and clears loading', async () => {
    const store = init({
      list: vi.fn(() => Promise.resolve({ ok: true, value: [m('a'), m('b')] })),
    });
    store.load(undefined);
    await flushMicrotasks();
    expect(store.matches().map(x => x.id)).toEqual(['a', 'b']);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('load sets loading=true while request is in flight', async () => {
    let resolve!: (v: unknown) => void;
    const deferred = new Promise(r => { resolve = r; });
    const store = init({ list: vi.fn(() => deferred) });
    store.load(undefined);
    expect(store.loading()).toBe(true);
    resolve({ ok: true, value: [] });
    await flushMicrotasks();
    expect(store.loading()).toBe(false);
  });

  it('load failure sets error and clears loading', async () => {
    const store = init({
      list: vi.fn(() => Promise.resolve({ ok: false, error: { code: 'mongo-not-configured' as const } })),
    });
    store.load(undefined);
    await flushMicrotasks();
    expect(store.error()?.code).toBe('mongo-not-configured');
    expect(store.loading()).toBe(false);
    expect(store.matches()).toEqual([]);
  });

  it('create success refreshes the list', async () => {
    // list is called once (on create success for refresh); no onInit hook
    const listFn = vi.fn(() => Promise.resolve({ ok: true, value: [m('new')] }));
    const createFn = vi.fn(() => Promise.resolve({ ok: true, value: m('new') }));
    const store = init({ list: listFn, create: createFn });
    store.create(req);
    // Flush all microtasks: create Promise + list Promise + internal RxJS scheduling
    await flushMicrotasks(5);
    expect(createFn).toHaveBeenCalledWith(req);
    expect(listFn).toHaveBeenCalledTimes(1); // called once for post-create refresh
    expect(store.matches().map(x => x.id)).toEqual(['new']);
    expect(store.createError()).toBeNull();
  });

  it('create failure sets createError and does not refresh list', async () => {
    const err: MatchError = { code: 'invalid-request' };
    const listFn = vi.fn(() => Promise.resolve({ ok: true, value: [] as Match[] }));
    const store = init({
      list: listFn,
      create: vi.fn(() => Promise.resolve({ ok: false, error: err })),
    });
    store.create(req);
    await flushMicrotasks(3);
    expect(store.createError()?.code).toBe('invalid-request');
    expect(listFn).not.toHaveBeenCalled(); // list not called on failure
  });
});
