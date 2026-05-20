import { DeckCardEntry } from './deck.types';

interface DeckShape {
  name: string;
  mainboard: DeckCardEntry[];
  sideboard: DeckCardEntry[];
}

function emitEntries(entries: DeckCardEntry[]): string {
  return entries.map(e => `${e.count} ${e.name}`).join('\n');
}

export function formatDeckArena(deck: DeckShape): string {
  const parts: string[] = [];
  const name = deck.name?.trim() ?? '';
  if (name) parts.push(name + '\n\n');

  const main = emitEntries(deck.mainboard);
  parts.push('Deck\n' + (main ? main + '\n' : ''));

  if (deck.sideboard.length > 0) {
    parts.push('\nSideboard\n' + emitEntries(deck.sideboard) + '\n');
  }

  return parts.join('');
}
