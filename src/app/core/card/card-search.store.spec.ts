import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardApi } from './card.api';
import { Card } from './card.types';
import { CardSearchStore } from './card-search.store';

function makeCard(name: string): Card {
  return { name, manaCost: '', types: ['Creature'], power: null, toughness: null, isImplemented: true, cmc: null, colors: [], oracleText: null };
}

describe('CardSearchStore', () => {
  let store: InstanceType<typeof CardSearchStore>;
  let search$: Subject<Card[]>;
  let getByName$: Subject<Card[]>;
  let searchSpy: ReturnType<typeof vi.fn>;
  let getByNameSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    search$ = new Subject<Card[]>();
    getByName$ = new Subject<Card[]>();
    searchSpy = vi.fn(() => search$);
    getByNameSpy = vi.fn(() => getByName$);
    TestBed.configureTestingModule({
      providers: [
        CardSearchStore,
        { provide: CardApi, useValue: { search: searchSpy, getByName: getByNameSpy } },
      ],
    });
    store = TestBed.inject(CardSearchStore);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setQuery debounces 400ms then queries', () => {
    store.setQuery('For');
    store.setQuery('Fore');
    store.setQuery('Forest');
    vi.advanceTimersByTime(399);
    expect(searchSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('Forest', 50, 0, {});
  });

  it('search results populate results + byName cache', () => {
    store.setQuery('Forest');
    vi.advanceTimersByTime(400);
    search$.next([makeCard('Forest'), makeCard('Mountain')]);
    expect(store.results()).toHaveLength(2);
    expect(store.byName()['Forest']?.name).toBe('Forest');
    expect(store.nextOffset()).toBe(2);
  });

  it('loadMore appends', () => {
    store.setQuery('a');
    vi.advanceTimersByTime(400);
    search$.next([makeCard('A1'), makeCard('A2')]);
    store.loadMore();
    search$.next([makeCard('A3')]);
    expect(store.results().map(c => c.name)).toEqual(['A1', 'A2', 'A3']);
    expect(store.nextOffset()).toBe(3);
  });

  it('a short page (fewer than 50 results) sets hasMore false', () => {
    store.setQuery('a');
    vi.advanceTimersByTime(400);
    search$.next([makeCard('A1'), makeCard('A2')]);
    expect(store.hasMore()).toBe(false);
  });

  it('a full page (exactly 50 results) sets hasMore true', () => {
    store.setQuery('a');
    vi.advanceTimersByTime(400);
    search$.next(Array.from({ length: 50 }, (_, i) => makeCard(`A${i}`)));
    expect(store.hasMore()).toBe(true);
  });

  it('loadMore on a full page keeps hasMore true while new cards keep arriving', () => {
    store.setQuery('a');
    vi.advanceTimersByTime(400);
    search$.next(Array.from({ length: 50 }, (_, i) => makeCard(`A${i}`)));
    store.loadMore();
    search$.next(Array.from({ length: 50 }, (_, i) => makeCard(`B${i}`)));
    expect(store.results()).toHaveLength(100);
    expect(store.hasMore()).toBe(true);
    expect(store.nextOffset()).toBe(100);
  });

  it('loadMore ending on a short page sets hasMore false', () => {
    store.setQuery('a');
    vi.advanceTimersByTime(400);
    search$.next(Array.from({ length: 50 }, (_, i) => makeCard(`A${i}`)));
    store.loadMore();
    search$.next([makeCard('B1')]);
    expect(store.hasMore()).toBe(false);
  });

  it('loadMore dedups by name — a server re-sending the same page does not duplicate results', () => {
    // Regression: the live /cards endpoint ignores `offset`, so loadMore
    // re-fetched page 1 and appended it verbatim, doubling the list.
    const page = Array.from({ length: 50 }, (_, i) => makeCard(`A${i}`));
    store.setQuery('a');
    vi.advanceTimersByTime(400);
    search$.next(page);
    store.loadMore();
    search$.next(page);
    expect(store.results()).toHaveLength(50);
    expect(new Set(store.results().map(c => c.name)).size).toBe(50);
    // A full page that contributed nothing new means pagination is not
    // progressing — stop offering "Load more".
    expect(store.hasMore()).toBe(false);
  });

  it('a new query resets hasMore from the fresh first page', () => {
    store.setQuery('a');
    vi.advanceTimersByTime(400);
    search$.next(Array.from({ length: 50 }, (_, i) => makeCard(`A${i}`)));
    expect(store.hasMore()).toBe(true);
    store.setQuery('zzz');
    vi.advanceTimersByTime(400);
    search$.next([makeCard('Z1')]);
    expect(store.hasMore()).toBe(false);
    expect(store.results()).toHaveLength(1);
  });

  it('error sets error flag', () => {
    store.setQuery('x');
    vi.advanceTimersByTime(400);
    search$.error(new Error('boom'));
    expect(store.error()).toBe('search-failed');
  });

  it('retry() re-runs the current query even when unchanged (bypasses distinctUntilChanged)', () => {
    // Reproduce the error path: search the query, it fails.
    store.setQuery('bolt');
    vi.advanceTimersByTime(400);
    search$.error(new Error('boom'));
    expect(store.error()).toBe('search-failed');

    const callsBefore = searchSpy.mock.calls.length;
    // A naive setQuery(query()) would be swallowed by distinctUntilChanged.
    // retry() must fire a fresh search with the same query.
    const retry$ = new Subject<Card[]>();
    searchSpy.mockImplementationOnce(() => retry$);
    store.retry();
    expect(searchSpy.mock.calls.length).toBe(callsBefore + 1);
    const lastCall = searchSpy.mock.calls[searchSpy.mock.calls.length - 1];
    expect(lastCall[0]).toBe('bolt');

    retry$.next([makeCard('Lightning Bolt')]);
    expect(store.error()).toBeNull();
    expect(store.results()).toHaveLength(1);
  });

  it('retry() sets loading and clears error before the re-run resolves', () => {
    store.setQuery('x');
    vi.advanceTimersByTime(400);
    search$.error(new Error('boom'));

    const retry$ = new Subject<Card[]>();
    searchSpy.mockImplementationOnce(() => retry$);
    store.retry();
    expect(store.loading()).toBe(true);
    expect(store.error()).toBeNull();
  });

  it('setFilters triggers search with current query + new filters', () => {
    store.setFilters({ colors: ['R'] });
    expect(searchSpy).toHaveBeenCalledWith('', 50, 0, { colors: ['R'] });
  });

  it('setQuery preserves filters set previously', () => {
    store.setFilters({ colors: ['R'] });
    // Resolve the setFilters search so the Subject is not errored
    search$.next([]);
    store.setQuery('bolt');
    vi.advanceTimersByTime(400);
    const lastCall = searchSpy.mock.calls[searchSpy.mock.calls.length - 1];
    expect(lastCall[0]).toBe('bolt');
    expect(lastCall[3]).toEqual({ colors: ['R'] });
  });

  describe('ensureCached', () => {
    it('calls getByName with missing names and populates byName cache', async () => {
      const forest = makeCard('Forest');
      const localGetByName$ = new Subject<Card[]>();
      getByNameSpy.mockImplementation(() => localGetByName$);

      const promise = store.ensureCached(['Forest']);
      localGetByName$.next([forest]);
      localGetByName$.complete();
      await promise;

      expect(getByNameSpy).toHaveBeenCalledWith(['Forest']);
      expect(store.byName()['Forest']?.name).toBe('Forest');
    });

    it('single round-trip for multiple names', async () => {
      const localGetByName$ = new Subject<Card[]>();
      getByNameSpy.mockImplementation(() => localGetByName$);

      const promise = store.ensureCached(['Forest', 'Mountain', 'Island']);
      localGetByName$.next([makeCard('Forest'), makeCard('Mountain'), makeCard('Island')]);
      localGetByName$.complete();
      await promise;

      // Only one call — not three separate search calls
      expect(getByNameSpy).toHaveBeenCalledTimes(1);
      expect(getByNameSpy).toHaveBeenCalledWith(['Forest', 'Mountain', 'Island']);
      expect(store.byName()['Island']?.name).toBe('Island');
    });

    it('skips names already in cache — does not call getByName', async () => {
      // Populate cache via a search first
      store.setQuery('Forest');
      vi.advanceTimersByTime(400);
      search$.next([makeCard('Forest')]);

      const callsBefore = getByNameSpy.mock.calls.length;
      await store.ensureCached(['Forest']);
      expect(getByNameSpy.mock.calls.length).toBe(callsBefore);
    });

    it('does nothing when all names are already cached', async () => {
      store.setQuery('Mountain');
      vi.advanceTimersByTime(400);
      search$.next([makeCard('Mountain')]);

      const callsBefore = getByNameSpy.mock.calls.length;
      await store.ensureCached(['Mountain']);
      expect(getByNameSpy.mock.calls.length).toBe(callsBefore);
    });

    it('deduplicates repeated names before calling getByName', async () => {
      const localGetByName$ = new Subject<Card[]>();
      getByNameSpy.mockImplementation(() => localGetByName$);

      const promise = store.ensureCached(['Forest', 'Forest', 'Forest']);
      localGetByName$.next([makeCard('Forest')]);
      localGetByName$.complete();
      await promise;

      expect(getByNameSpy).toHaveBeenCalledTimes(1);
      const [namesArg] = getByNameSpy.mock.calls[0];
      expect(namesArg).toEqual(['Forest']);
    });

    it('handles fetch errors gracefully without crashing', async () => {
      const { Subject: Subj } = await import('rxjs');
      const errGetByName$ = new Subj<Card[]>();
      getByNameSpy.mockImplementation(() => errGetByName$);

      const promise = store.ensureCached(['BadCard']);
      errGetByName$.error(new Error('network error'));
      await expect(promise).resolves.toBeUndefined();
    });

    it('does not crash when getByName returns empty array', async () => {
      const localGetByName$ = new Subject<Card[]>();
      getByNameSpy.mockImplementation(() => localGetByName$);

      const promise = store.ensureCached(['Nonexistent']);
      localGetByName$.next([]);
      localGetByName$.complete();
      await expect(promise).resolves.toBeUndefined();
    });
  });
});
