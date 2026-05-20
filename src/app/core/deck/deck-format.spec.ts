import { describe, expect, it } from 'vitest';
import { formatDeckArena } from './deck-format';

describe('formatDeckArena', () => {
  it('formats deck with name + mainboard + sideboard', () => {
    const out = formatDeckArena({
      name: 'Mono-G',
      mainboard: [
        { name: 'Forest', count: 24 },
        { name: 'Grizzly Bears', count: 4 },
      ],
      sideboard: [
        { name: 'Spike Feeder', count: 3 },
      ],
    });

    expect(out).toBe(
      'Mono-G\n' +
      '\n' +
      'Deck\n' +
      '24 Forest\n' +
      '4 Grizzly Bears\n' +
      '\n' +
      'Sideboard\n' +
      '3 Spike Feeder\n'
    );
  });

  it('omits sideboard section when empty', () => {
    const out = formatDeckArena({
      name: 'Test',
      mainboard: [{ name: 'Mountain', count: 60 }],
      sideboard: [],
    });

    expect(out).toBe('Test\n\nDeck\n60 Mountain\n');
  });

  it('omits name line when name is blank', () => {
    const out = formatDeckArena({
      name: '',
      mainboard: [{ name: 'Forest', count: 60 }],
      sideboard: [],
    });

    expect(out).toBe('Deck\n60 Forest\n');
  });
});
