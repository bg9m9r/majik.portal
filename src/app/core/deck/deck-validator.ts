import { Card } from '../card/card.types';
import { DeckCardEntry } from './deck.types';

const LEGAL_TYPES = ['Instant', 'Sorcery', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'];

function sum(entries: DeckCardEntry[], sel: (e: DeckCardEntry) => number): number {
  let s = 0;
  for (const e of entries) s += sel(e);
  return s;
}

function checkDuplicates(entries: DeckCardEntry[], zone: 'mainboard' | 'sideboard', errors: string[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) errors.push(`duplicate entry in ${zone}: ${e.name}`);
    seen.add(e.name);
  }
}

export function validateDeck(
  deck: { name: string; mainboard: DeckCardEntry[]; sideboard: DeckCardEntry[] },
  cardLookup: (name: string) => Card | undefined,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!deck.name?.trim()) errors.push('deck name required');

  const mainCount = sum(deck.mainboard, e => e.count);
  if (mainCount < 60) errors.push(`main deck has ${mainCount} cards; minimum 60`);

  const sideCount = sum(deck.sideboard, e => e.count);
  if (sideCount > 15) errors.push(`sideboard has ${sideCount} cards; maximum 15`);

  checkDuplicates(deck.mainboard, 'mainboard', errors);
  checkDuplicates(deck.sideboard, 'sideboard', errors);

  for (const e of [...deck.mainboard, ...deck.sideboard]) {
    if (e.count < 1) errors.push(`${e.name}: count must be at least 1`);
  }

  const totals = new Map<string, number>();
  for (const e of [...deck.mainboard, ...deck.sideboard]) {
    totals.set(e.name, (totals.get(e.name) ?? 0) + e.count);
  }

  for (const [name, total] of totals) {
    const card = cardLookup(name);
    if (!card) { errors.push(`unknown card: ${name}`); continue; }
    if (!card.isImplemented) errors.push(`not implemented: ${name}`);

    const typeStr = card.types.join(' ');
    const lower = typeStr.toLowerCase();
    if (lower.includes('token')) {
      errors.push(`${name}: type not legal in Constructed`);
    } else if (!LEGAL_TYPES.some(t => typeStr.includes(t))) {
      errors.push(`${name}: type not legal in Constructed`);
    }

    const isBasicLand = lower.includes('basic') && lower.includes('land');
    if (!isBasicLand && total > 4) {
      errors.push(`${name}: ${total} copies combined main+side (max 4)`);
    }
  }

  return { ok: errors.length === 0, errors };
}
