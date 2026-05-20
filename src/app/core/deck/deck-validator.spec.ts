import { describe, expect, it } from 'vitest';
import { Card } from '../card/card.types';
import { DeckCardEntry } from './deck.types';
import { validateDeck } from './deck-validator';

function card(over: Partial<Card>): Card {
  return { name: '?', manaCost: '', types: ['Creature'], power: null, toughness: null, isImplemented: true, ...over };
}

const forest = card({ name: 'Forest', types: ['Basic', 'Land'] });
const bears = card({ name: 'Grizzly Bears', types: ['Creature'] });
const hillGiant = card({ name: 'Hill Giant', types: ['Creature'] });
const unimplemented = card({ name: 'Black Lotus', isImplemented: false });
const token = card({ name: 'Soldier', types: ['Token', 'Creature'] });
const tribal = card({ name: 'Goblin War Drums', types: ['Tribal'] });

const lookup = (cards: Card[]) => (name: string) => cards.find(c => c.name === name);

function deck(name: string, main: DeckCardEntry[], side: DeckCardEntry[] = []) {
  return { name, mainboard: main, sideboard: side };
}

describe('validateDeck', () => {
  it('valid 60 forest + bears + giant', () => {
    const r = validateDeck(
      deck('Test', [{ name: 'Forest', count: 52 }, { name: 'Grizzly Bears', count: 4 }, { name: 'Hill Giant', count: 4 }]),
      lookup([forest, bears, hillGiant])
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('valid 60 main + 15 sideboard', () => {
    const r = validateDeck(
      deck('Test',
        [{ name: 'Forest', count: 56 }, { name: 'Grizzly Bears', count: 4 }],
        [{ name: 'Forest', count: 15 }]),
      lookup([forest, bears])
    );
    expect(r.ok).toBe(true);
  });

  it('undersize main', () => {
    const r = validateDeck(deck('T', [{ name: 'Forest', count: 30 }]), lookup([forest]));
    expect(r.errors).toContain('main deck has 30 cards; minimum 60');
  });

  it('oversize sideboard', () => {
    const r = validateDeck(
      deck('T', [{ name: 'Forest', count: 60 }], [{ name: 'Forest', count: 16 }]),
      lookup([forest])
    );
    expect(r.errors).toContain('sideboard has 16 cards; maximum 15');
  });

  it('duplicate entry in mainboard', () => {
    const r = validateDeck(
      deck('T', [{ name: 'Forest', count: 30 }, { name: 'Forest', count: 30 }]),
      lookup([forest])
    );
    expect(r.errors.some(e => /duplicate.*mainboard.*Forest/i.test(e))).toBe(true);
  });

  it('count below 1', () => {
    const r = validateDeck(
      deck('T', [{ name: 'Forest', count: 60 }, { name: 'Grizzly Bears', count: 0 }]),
      lookup([forest, bears])
    );
    expect(r.errors).toContain('Grizzly Bears: count must be at least 1');
  });

  it('unknown card name', () => {
    const r = validateDeck(deck('T', [{ name: 'Mystery', count: 60 }]), lookup([]));
    expect(r.errors).toContain('unknown card: Mystery');
  });

  it('not-implemented card', () => {
    const r = validateDeck(
      deck('T', [{ name: 'Forest', count: 56 }, { name: 'Black Lotus', count: 4 }]),
      lookup([forest, unimplemented])
    );
    expect(r.errors).toContain('not implemented: Black Lotus');
  });

  it('token type illegal', () => {
    const r = validateDeck(
      deck('T', [{ name: 'Forest', count: 56 }, { name: 'Soldier', count: 4 }]),
      lookup([forest, token])
    );
    expect(r.errors).toContain('Soldier: type not legal in Constructed');
  });

  it('non-supertype-listed type illegal', () => {
    const r = validateDeck(
      deck('T', [{ name: 'Forest', count: 56 }, { name: 'Goblin War Drums', count: 4 }]),
      lookup([forest, tribal])
    );
    expect(r.errors).toContain('Goblin War Drums: type not legal in Constructed');
  });

  it('5 non-basic copies combined main+side illegal', () => {
    const r = validateDeck(
      deck('T',
        [{ name: 'Grizzly Bears', count: 4 }, { name: 'Forest', count: 56 }],
        [{ name: 'Grizzly Bears', count: 1 }]),
      lookup([forest, bears])
    );
    expect(r.errors).toContain('Grizzly Bears: 5 copies combined main+side (max 4)');
  });

  it('basic land allows >4', () => {
    const r = validateDeck(deck('T', [{ name: 'Forest', count: 60 }]), lookup([forest]));
    expect(r.errors).toEqual([]);
  });

  it('empty name flagged', () => {
    const r = validateDeck(deck('', [{ name: 'Forest', count: 60 }]), lookup([forest]));
    expect(r.errors).toContain('deck name required');
  });
});
