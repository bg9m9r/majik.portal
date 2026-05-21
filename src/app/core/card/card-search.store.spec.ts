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
  let searchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    search$ = new Subject<Card[]>();
    searchSpy = vi.fn(() => search$);
    TestBed.configureTestingModule({
      providers: [
        CardSearchStore,
        { provide: CardApi, useValue: { search: searchSpy } },
      ],
    });
    store = TestBed.inject(CardSearchStore);
    vi.useFakeTimers();
  });

  it('setQuery debounces 250ms then queries', () => {
    store.setQuery('For');
    store.setQuery('Fore');
    store.setQuery('Forest');
    vi.advanceTimersByTime(249);
    expect(searchSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('Forest', 50, 0, {});
  });

  it('search results populate results + byName cache', () => {
    store.setQuery('Forest');
    vi.advanceTimersByTime(250);
    search$.next([makeCard('Forest'), makeCard('Mountain')]);
    expect(store.results()).toHaveLength(2);
    expect(store.byName()['Forest']?.name).toBe('Forest');
    expect(store.nextOffset()).toBe(2);
  });

  it('loadMore appends', () => {
    store.setQuery('a');
    vi.advanceTimersByTime(250);
    search$.next([makeCard('A1'), makeCard('A2')]);
    store.loadMore();
    search$.next([makeCard('A3')]);
    expect(store.results().map(c => c.name)).toEqual(['A1', 'A2', 'A3']);
    expect(store.nextOffset()).toBe(3);
  });

  it('error sets error flag', () => {
    store.setQuery('x');
    vi.advanceTimersByTime(250);
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
    vi.advanceTimersByTime(250);
    const lastCall = searchSpy.mock.calls[searchSpy.mock.calls.length - 1];
    expect(lastCall[0]).toBe('bolt');
    expect(lastCall[3]).toEqual({ colors: ['R'] });
  });

  describe('ensureCached', () => {
    it('fetches missing names and populates byName cache', async () => {
      const forest = makeCard('Forest');
      search$.next([]);  // drain any pending subjects
      const localSearch$ = new Subject<Card[]>();
      searchSpy.mockImplementation(() => localSearch$);

      const promise = store.ensureCached(['Forest']);
      localSearch$.next([forest]);
      localSearch$.complete();
      await promise;

      expect(store.byName()['Forest']?.name).toBe('Forest');
    });

    it('skips names already in cache', async () => {
      // Populate cache via a search first
      store.setQuery('Forest');
      vi.advanceTimersByTime(250);
      search$.next([makeCard('Forest')]);

      const callsBefore = searchSpy.mock.calls.length;
      await store.ensureCached(['Forest']);
      expect(searchSpy.mock.calls.length).toBe(callsBefore);
    });

    it('does nothing when all names are already cached', async () => {
      store.setQuery('Mountain');
      vi.advanceTimersByTime(250);
      search$.next([makeCard('Mountain')]);

      const callsBefore = searchSpy.mock.calls.length;
      await store.ensureCached(['Mountain']);
      expect(searchSpy.mock.calls.length).toBe(callsBefore);
    });

    it('uses implementedOnly=false when fetching by name', async () => {
      const localSearch$ = new Subject<Card[]>();
      searchSpy.mockImplementation(() => localSearch$);

      const promise = store.ensureCached(['Grizzly Bears']);
      localSearch$.next([makeCard('Grizzly Bears')]);
      localSearch$.complete();
      await promise;

      const lastCall = searchSpy.mock.calls[searchSpy.mock.calls.length - 1];
      expect(lastCall[4]).toBe(false);
    });

    it('handles fetch errors gracefully without crashing', async () => {
      const { Subject: Subj } = await import('rxjs');
      const errSearch$ = new Subj<Card[]>();
      searchSpy.mockImplementation(() => errSearch$);

      const promise = store.ensureCached(['BadCard']);
      errSearch$.error(new Error('network error'));
      await expect(promise).resolves.toBeUndefined();
    });
  });
});
