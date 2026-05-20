import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { DecksStore } from '../../../core/deck/deck.store';
import { Deck } from '../../../core/deck/deck.types';
import { DecksListComponent } from './decks-list';

const fixt = (id: string): Deck => ({
  id, ownerSub: 'u', name: id, mainboard: [{ name: 'Forest', count: 60 }],
  sideboard: [], createdAt: 't', updatedAt: 't',
});

function render(stub: Partial<InstanceType<typeof DecksStore>>) {
  TestBed.configureTestingModule({
    imports: [DecksListComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: DecksStore, useValue: stub },
    ],
  });
  const fx = TestBed.createComponent(DecksListComponent);
  fx.detectChanges();
  return fx;
}

describe('DecksListComponent', () => {
  it('shows empty state when no decks', () => {
    const fx = render({ all: () => [], count: () => 0, loading: () => false, error: () => null, remove: vi.fn() } as any);
    expect(fx.nativeElement.textContent).toContain('— no decks yet —');
    expect(fx.nativeElement.querySelector('a[href="/decks/new"]')).not.toBeNull();
  });

  it('lists decks', () => {
    const fx = render({
      all: () => [fixt('alpha'), fixt('beta')],
      count: () => 2, loading: () => false, error: () => null, remove: vi.fn(),
    } as any);
    expect(fx.nativeElement.textContent).toContain('alpha');
    expect(fx.nativeElement.textContent).toContain('beta');
  });

  it('delete calls store.remove after confirm', () => {
    const remove = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fx = render({
      all: () => [fixt('alpha')], count: () => 1, loading: () => false, error: () => null, remove,
    } as any);
    const btn = fx.nativeElement.querySelector('button[data-action="delete"]') as HTMLButtonElement;
    btn.click();
    expect(remove).toHaveBeenCalledWith('alpha');
  });
});
