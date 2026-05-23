import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameStore } from './game.store';
import { GameState } from './match.types';

const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function snapshot(): GameState {
  return {
    gameId: 'g-1', phase: 'PreCombatMain', turnNumber: 2, activePlayerId: ALICE,
    players: [
      {
        id: ALICE, name: 'Alice', life: 20,
        mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
        hand: { cards: [] }, library: { cards: [] }, graveyard: { cards: [] },
        exile: { cards: [] }, battlefield: { cards: [] },
      },
      {
        id: BOB, name: 'Bob', life: 20,
        mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
        hand: { cards: [] }, library: { cards: [] }, graveyard: { cards: [] },
        exile: { cards: [] }, battlefield: { cards: [] },
      },
    ],
    stack: [],
  };
}

describe('GameStore.applyEvent', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(GameStore);
    store.reset();
  });

  it('returns false when no snapshot is loaded', () => {
    expect(store.applyEvent({ type: 'LifeChangedEvent', payload: { playerId: ALICE, current: 18 } })).toBe(false);
  });

  it('applies LifeChangedEvent and bumps stateVersion', () => {
    store.setState(snapshot());
    const v0 = store.stateVersion();
    const ok = store.applyEvent({
      type: 'LifeChangedEvent',
      payload: { playerId: BOB, previous: 20, current: 17 },
    });
    expect(ok).toBe(true);
    expect(store.state()!.players.find(p => p.id === BOB)!.life).toBe(17);
    expect(store.stateVersion()).toBe(v0 + 1);
  });

  it('returns false for unknown event types so caller refetches', () => {
    store.setState(snapshot());
    const v0 = store.stateVersion();
    const ok = store.applyEvent({ type: 'SpellCastEvent', payload: { stackId: 's' } });
    expect(ok).toBe(false);
    expect(store.stateVersion()).toBe(v0);
  });

  it('tolerates PascalCase EventDto envelope keys', () => {
    store.setState(snapshot());
    const ok = store.applyEvent({
      EventId: 'e', Type: 'PhaseChangedEvent', At: '2026-01-01T00:00:00Z',
      Payload: { from: 'X', to: 'Combat' },
    });
    expect(ok).toBe(true);
    expect(store.state()!.phase).toBe('Combat');
  });

  it('returns false on a malformed payload (life event missing playerId)', () => {
    store.setState(snapshot());
    const ok = store.applyEvent({ type: 'LifeChangedEvent', payload: { current: 5 } });
    expect(ok).toBe(false);
  });
});
