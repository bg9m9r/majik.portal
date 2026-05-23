import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameStore } from './game.store';
import { BotDecision, GameState } from './match.types';

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

// Tests focused on the bot-decision ring buffer behaviour — independent
// from the engine-event reducer above. The ring is appended via
// pushBotDecision (newest first) and capped at MAX_RECENT_DECISIONS=10.
describe('GameStore.recentDecisions', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(GameStore);
    // Re-entrant: signalStore is providedIn:'root', so reset to
    // initial between specs to avoid bleed.
    store.reset();
  });

  function decision(chosen: string, score = 0): BotDecision {
    return {
      decisionType: 'Priority',
      chosen,
      chosenScore: score,
      alternatives: [],
      context: {},
      receivedAt: Date.now(),
    };
  }

  it('starts with no recent decisions', () => {
    expect(store.recentDecisions()).toEqual([]);
  });

  it('pushBotDecision prepends to the ring (newest first)', () => {
    store.pushBotDecision(decision('A'));
    store.pushBotDecision(decision('B'));
    store.pushBotDecision(decision('C'));

    const r = store.recentDecisions();
    expect(r.map(d => d.chosen)).toEqual(['C', 'B', 'A']);
  });

  it('caps the ring at 10 entries (oldest dropped)', () => {
    // Append 15 — only the last 10 should survive, with the most
    // recent at index 0.
    for (let i = 0; i < 15; i++) {
      store.pushBotDecision(decision(`d${i}`));
    }
    const r = store.recentDecisions();
    expect(r).toHaveLength(10);
    expect(r[0].chosen).toBe('d14');
    expect(r[9].chosen).toBe('d5');
    // Older entries dropped entirely.
    expect(r.find(d => d.chosen === 'd4')).toBeUndefined();
  });

  it('clearBotDecisions empties the ring without touching state', () => {
    store.pushBotDecision(decision('A'));
    expect(store.recentDecisions()).toHaveLength(1);
    store.clearBotDecisions();
    expect(store.recentDecisions()).toEqual([]);
  });

  it('reset clears the ring along with everything else', () => {
    store.pushBotDecision(decision('A'));
    store.reset();
    expect(store.recentDecisions()).toEqual([]);
  });
});
