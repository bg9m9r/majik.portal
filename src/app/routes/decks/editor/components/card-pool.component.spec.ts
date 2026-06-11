import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CardSearchStore } from '../../../../core/card/card-search.store';
import { Card } from '../../../../core/card/card.types';
import { CardPoolComponent } from './card-pool.component';

function makeCard(name: string): Card {
  return { name, manaCost: '', types: ['Creature'], power: null, toughness: null, isImplemented: true, cmc: null, colors: [], oracleText: null };
}

function setup(overrides: { results?: Card[]; hasMore?: boolean } = {}) {
  const store = {
    byName: () => ({}),
    query: () => 'bolt',
    results: () => overrides.results ?? [makeCard('Lightning Bolt')],
    hasMore: () => overrides.hasMore ?? false,
    loading: () => false,
    prefetching: () => 0,
    error: () => null,
    filters: () => ({}),
    setQuery: vi.fn(),
    setFilters: vi.fn(),
    loadMore: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [CardPoolComponent],
    providers: [{ provide: CardSearchStore, useValue: store }],
  });
  const fx = TestBed.createComponent(CardPoolComponent);
  fx.detectChanges();
  return { fx, store };
}

function loadMoreButton(fx: { nativeElement: HTMLElement }): HTMLButtonElement | null {
  return Array.from(fx.nativeElement.querySelectorAll('button'))
    .find(b => b.textContent?.trim() === 'Load more') ?? null;
}

describe('CardPoolComponent', () => {
  it('hides "Load more" when the store says there are no more pages', () => {
    // Regression: the button used to render for ANY non-empty result list,
    // even a 1-card result that could never have a second page.
    const { fx } = setup({ results: [makeCard('Lightning Bolt')], hasMore: false });
    expect(loadMoreButton(fx)).toBeNull();
  });

  it('shows "Load more" when the store reports more pages', () => {
    const { fx, store } = setup({ hasMore: true });
    const btn = loadMoreButton(fx);
    expect(btn).not.toBeNull();
    btn!.click();
    expect(store.loadMore).toHaveBeenCalledTimes(1);
  });
});
