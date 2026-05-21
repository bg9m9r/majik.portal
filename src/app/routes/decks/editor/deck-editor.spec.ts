import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { DeckEditorComponent } from './deck-editor';
import { DeckEditorStore } from '../../../core/deck/deck-editor.store';
import { CardSearchStore } from '../../../core/card/card-search.store';
import { DecksStore } from '../../../core/deck/deck.store';

function setup(routeId: string | null) {
  TestBed.configureTestingModule({
    imports: [DeckEditorComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: DecksStore, useValue: { upsert: vi.fn(), all: () => [], count: () => 0, loading: () => false, error: () => null } },
      { provide: CardSearchStore, useValue: { byName: () => ({}), query: () => '', results: () => [], loading: () => false, prefetching: () => 0, error: () => null, filters: () => ({}), setQuery: vi.fn(), setFilters: vi.fn(), loadMore: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(routeId ? { id: routeId } : {}) } } },
    ],
  });
  return TestBed.createComponent(DeckEditorComponent);
}

describe('DeckEditorComponent', () => {
  it('renders 3 columns', () => {
    const fx = setup(null);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('app-card-pool')).not.toBeNull();
    expect(fx.nativeElement.querySelector('app-zone-editor')).not.toBeNull();
    expect(fx.nativeElement.querySelector('app-deck-info-panel')).not.toBeNull();
  });

  it('canDeactivate returns true when not dirty', () => {
    const fx = setup(null);
    fx.detectChanges();
    expect(fx.componentInstance.canDeactivate()).toBe(true);
  });

  it('canDeactivate reflects store.dirty()', () => {
    const fx = setup(null);
    fx.detectChanges();
    fx.componentInstance.store.rename('changed');
    expect(fx.componentInstance.canDeactivate()).toBe(false);
  });
});
