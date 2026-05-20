import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ManaCurveComponent } from './mana-curve.component';
import { DeckEditorStore } from '../../../../core/deck/deck-editor.store';
import { CardSearchStore } from '../../../../core/card/card-search.store';
import { Card } from '../../../../core/card/card.types';

function card(name: string, cmc: number | null, types: string[]): Card {
  return { name, cmc, types, manaCost: '', power: null, toughness: null, isImplemented: true, colors: [], oracleText: null };
}

function setup(mainboard: { name: string; count: number }[], byName: Record<string, Card>) {
  TestBed.configureTestingModule({
    imports: [ManaCurveComponent],
    providers: [
      { provide: DeckEditorStore, useValue: { mainboard: () => mainboard } },
      { provide: CardSearchStore, useValue: { byName: () => byName } },
    ],
  });
  const fx = TestBed.createComponent(ManaCurveComponent);
  fx.detectChanges();
  return fx;
}

describe('ManaCurveComponent', () => {
  it('buckets non-land cards by cmc', () => {
    const fx = setup(
      [
        { name: 'Bolt', count: 4 },
        { name: 'Bears', count: 4 },
        { name: 'Forest', count: 24 },
      ],
      {
        Bolt: card('Bolt', 1, ['Instant']),
        Bears: card('Bears', 2, ['Creature']),
        Forest: card('Forest', null, ['Basic', 'Land']),
      }
    );
    const b = fx.componentInstance.buckets();
    expect(b[1].count).toBe(4);
    expect(b[2].count).toBe(4);
    expect(b[0].count).toBe(0);  // Forest is land, excluded
  });

  it('groups cmc >= 7 into 7+ bucket', () => {
    const fx = setup(
      [
        { name: 'Big', count: 2 },
        { name: 'Bigger', count: 1 },
      ],
      {
        Big: card('Big', 7, ['Creature']),
        Bigger: card('Bigger', 12, ['Creature']),
      }
    );
    expect(fx.componentInstance.buckets()[7].count).toBe(3);
  });

  it('renders 8 bars', () => {
    const fx = setup([], {});
    expect(fx.componentInstance.buckets()).toHaveLength(8);
  });
});
