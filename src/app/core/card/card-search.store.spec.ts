import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
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

  it('error sets error flag', () => {
    store.setQuery('x');
    vi.advanceTimersByTime(400);
    search$.error(new Error('boom'));
    expect(store.error()).toBe('search-failed');
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
