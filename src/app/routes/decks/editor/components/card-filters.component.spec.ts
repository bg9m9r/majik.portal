import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CardFiltersComponent } from './card-filters.component';
import { CardSearchStore } from '../../../../core/card/card-search.store';

function makeStub(initial: any = {}) {
  let filters: any = initial;
  return {
    filters: () => filters,
    setFilters: vi.fn((f: any) => { filters = f; }),
  };
}

function render(stub: any) {
  TestBed.configureTestingModule({
    imports: [CardFiltersComponent],
    providers: [{ provide: CardSearchStore, useValue: stub }],
  });
  const fx = TestBed.createComponent(CardFiltersComponent);
  fx.detectChanges();
  return fx;
}

describe('CardFiltersComponent', () => {
  it('toggle color chip updates store via setFilters', () => {
    const stub = makeStub();
    const fx = render(stub);
    const rBtn = fx.nativeElement.querySelector('button[data-color="R"]') as HTMLButtonElement;
    rBtn.click();

    expect(stub.setFilters).toHaveBeenCalledWith(expect.objectContaining({ colors: ['R'] }));
  });

  it('clear button resets filters', () => {
    const stub = makeStub({ colors: ['R'] });
    const fx = render(stub);
    const clearBtn = fx.nativeElement.querySelector('button[data-action="clear"]') as HTMLButtonElement;
    clearBtn.click();

    expect(stub.setFilters).toHaveBeenCalledWith({});
  });
});
