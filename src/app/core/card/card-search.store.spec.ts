import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CardApi } from './card.api';
import { Card } from './card.types';
import { CardSearchStore } from './card-search.store';

function makeCard(name: string): Card {
  return { name, manaCost: '', types: ['Creature'], power: null, toughness: null, isImplemented: true };
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
    expect(searchSpy).toHaveBeenCalledWith('Forest', 50, 0);
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
});
