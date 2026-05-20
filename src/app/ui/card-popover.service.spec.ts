import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { CardPopoverService } from './card-popover.service';
import { Card } from '../core/card/card.types';

const card: Card = {
  name: 'Forest',
  manaCost: '',
  types: ['Basic', 'Land'],
  power: null,
  toughness: null,
  isImplemented: true,
  cmc: null,
  colors: [],
  oracleText: null,
};

describe('CardPopoverService', () => {
  let svc: CardPopoverService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CardPopoverService] });
    svc = TestBed.inject(CardPopoverService);
  });

  it('starts empty', () => {
    expect(svc.current()).toBeNull();
  });

  it('show sets anchor', () => {
    const rect = new DOMRect(0, 0, 100, 140);
    svc.show(card, rect);
    expect(svc.current()?.card.name).toBe('Forest');
  });

  it('hide clears', () => {
    svc.show(card, new DOMRect(0, 0, 100, 140));
    svc.hide();
    expect(svc.current()).toBeNull();
  });
});
