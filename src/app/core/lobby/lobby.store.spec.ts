import { TestBed } from '@angular/core/testing';
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

/**
 * Flush pending microtasks. Each resolved Promise resolves in a microtask;
 * chaining multiple `await Promise.resolve()` drains several layers of
 * nesting (RxJS from(Promise) → tapResponse → patchState).
 */
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

  it('load on init populates matches', async () => {
    const store = init({
      list: vi.fn(() => Promise.resolve({ ok: true, value: [m('a'), m('b')] })),
    });
    await flushMicrotasks();
    expect(store.matches().map(x => x.id)).toEqual(['a', 'b']);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('load error sets error state', async () => {
    const store = init({
      list: vi.fn(() => Promise.resolve({ ok: false, error: { code: 'mongo-not-configured' as const } })),
    });
    await flushMicrotasks();
    expect(store.error()?.code).toBe('mongo-not-configured');
    expect(store.loading()).toBe(false);
  });

  it('load() retries after an error: clears error + repopulates on success', async () => {
    // onInit load fails, then an explicit load() (the error-state Retry
    // button) succeeds and clears the error.
    const listFn = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'network' as const } })
      .mockResolvedValue({ ok: true, value: [m('a')] });
    const store = init({ list: listFn });
    await flushMicrotasks();
    expect(store.error()?.code).toBe('network');

    store.load(); // Retry
    // tap() clears the error synchronously before the request resolves.
    expect(store.error()).toBeNull();
    expect(store.loading()).toBe(true);
    await flushMicrotasks();
    expect(store.error()).toBeNull();
    expect(store.matches().map(x => x.id)).toEqual(['a']);
  });

  it('load sets loading=true while request is in flight', async () => {
    let resolve!: (v: unknown) => void;
    const deferred = new Promise(r => { resolve = r; });
    const store = init({ list: vi.fn(() => deferred) });
    // onInit fires load(); tap sets loading synchronously
    expect(store.loading()).toBe(true);
    resolve({ ok: true, value: [] });
    await flushMicrotasks();
    expect(store.loading()).toBe(false);
  });

  it('create success calls create + refreshes the list', async () => {
    // First list call: onInit load (returns []); second: post-create refresh
    const listFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [] as Match[] })
      .mockResolvedValue({ ok: true, value: [m('new')] });
    const createFn = vi.fn(() => Promise.resolve({ ok: true, value: m('new') }));
    const store = init({ list: listFn, create: createFn });
    await flushMicrotasks(); // let onInit load settle
    store.create(req);
    // Two more async hops: create Promise, then list refresh Promise
    await flushMicrotasks(2);
    expect(createFn).toHaveBeenCalledWith(req);
    expect(store.matches().map(x => x.id)).toEqual(['new']);
    expect(store.createError()).toBeNull();
  });

  it('create failure sets createError and does not call list again', async () => {
    const err: MatchError = { code: 'invalid-request' };
    const listFn = vi.fn(() => Promise.resolve({ ok: true, value: [] as Match[] }));
    const store = init({
      list: listFn,
      create: vi.fn(() => Promise.resolve({ ok: false, error: err })),
    });
    await flushMicrotasks(); // let onInit load settle
    const callsBefore = listFn.mock.calls.length; // 1 from onInit
    store.create(req);
    await flushMicrotasks(3);
    expect(store.createError()?.code).toBe('invalid-request');
    expect(listFn.mock.calls.length).toBe(callsBefore); // no additional list call
  });
});
