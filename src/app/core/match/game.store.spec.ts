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
    youPlayerId: null,
  };
}

// ----------------------------------------------------------------
// GameStore.setState — seat-identity derivation from youPlayerId
// ----------------------------------------------------------------
describe('GameStore.setState — seat identity from youPlayerId', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(GameStore);
    store.reset();
  });

  it('derives selfPlayerIds from youPlayerId when present', () => {
    const snap: GameState = { ...snapshot(), youPlayerId: ALICE };
    store.setState(snap);
    expect(store.selfPlayerIds()).toEqual([ALICE]);
  });

  it('isMyTurnPrompt is true when prompt.playerId matches the youPlayerId-derived seat', () => {
    const snap: GameState = { ...snapshot(), youPlayerId: ALICE };
    store.setState(snap);
    store.setPrompt({ gameId: 'g-1', playerId: ALICE, expectedKinds: ['PassPriorityCommand'] });
    expect(store.isMyTurnPrompt()).toBe(true);
  });

  it('isMyTurnPrompt is false when prompt belongs to opponent', () => {
    const snap: GameState = { ...snapshot(), youPlayerId: ALICE };
    store.setState(snap);
    store.setPrompt({ gameId: 'g-1', playerId: BOB, expectedKinds: ['PassPriorityCommand'] });
    expect(store.isMyTurnPrompt()).toBe(false);
  });

  it('retains prior selfPlayerIds when snapshot lacks youPlayerId (spectator / old server)', () => {
    store.setSelfPlayerIds([BOB]);
    const snap: GameState = { ...snapshot(), youPlayerId: null };
    store.setState(snap);
    expect(store.selfPlayerIds()).toEqual([BOB]);
  });

  it('updates selfPlayerIds when a later snapshot carries youPlayerId', () => {
    store.setSelfPlayerIds([BOB]);
    const snap: GameState = { ...snapshot(), youPlayerId: ALICE };
    store.setState(snap);
    expect(store.selfPlayerIds()).toEqual([ALICE]);
  });
});

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

describe('GameStore.phaseStops', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(GameStore);
    store.reset();
  });

  it('cycles a phase chip null → mine → theirs → null', () => {
    expect(store.phaseStops()).toEqual({});

    store.togglePhaseStop('Untap');
    expect(store.phaseStops()['Untap']).toBe('mine');

    store.togglePhaseStop('Untap');
    expect(store.phaseStops()['Untap']).toBe('theirs');

    store.togglePhaseStop('Untap');
    expect(store.phaseStops()['Untap']).toBeUndefined();
  });

  it('tracks each phase independently', () => {
    store.togglePhaseStop('Untap');         // mine
    store.togglePhaseStop('PreCombatMain'); // mine
    store.togglePhaseStop('PreCombatMain'); // theirs

    expect(store.phaseStops()).toEqual({
      Untap: 'mine',
      PreCombatMain: 'theirs',
    });
  });

  it('clearPhaseStops wipes all entries', () => {
    store.togglePhaseStop('Untap');
    store.togglePhaseStop('Draw');
    store.clearPhaseStops();
    expect(store.phaseStops()).toEqual({});
  });

  it('reset clears phase stops along with everything else', () => {
    store.togglePhaseStop('Untap');
    store.reset();
    expect(store.phaseStops()).toEqual({});
  });
});

describe('GameStore.landsPlayedThisTurn — CR 305.2 land-drop tracker (client-derived)', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(GameStore);
    store.reset();
    store.setState(snapshot());
    store.setSelfPlayerIds([ALICE]);
  });

  it('starts at 0', () => {
    expect(store.landsPlayedThisTurn()).toBe(0);
  });

  it('increments on viewer-owned CardMovedEvent (Hand → Battlefield, Land)', () => {
    const ok = store.applyEvent({
      type: 'CardMovedEvent',
      payload: {
        cardId: 'c-forest', cardName: 'Forest', ownerId: ALICE,
        manaCost: '', types: ['Land', 'Basic'],
        from: 'Hand', to: 'Battlefield',
      },
    });
    // Battlefield destination isn't structurally patchable (returns
    // null from the reducer → caller refetches), but the lands counter
    // is bookkept independently.
    expect(ok).toBe(false);
    expect(store.landsPlayedThisTurn()).toBe(1);
  });

  it('does NOT increment for the opponent playing a land', () => {
    store.applyEvent({
      type: 'CardMovedEvent',
      payload: {
        cardId: 'c-forest', cardName: 'Forest', ownerId: BOB,
        types: ['Land'], from: 'Hand', to: 'Battlefield',
      },
    });
    expect(store.landsPlayedThisTurn()).toBe(0);
  });

  it('does NOT increment when the moving card is not a Land', () => {
    store.applyEvent({
      type: 'CardMovedEvent',
      payload: {
        cardId: 'c-bear', cardName: 'Grizzly Bears', ownerId: ALICE,
        types: ['Creature'], from: 'Hand', to: 'Battlefield',
      },
    });
    expect(store.landsPlayedThisTurn()).toBe(0);
  });

  it('does NOT increment for a Hand → other-zone move (e.g. discard)', () => {
    store.applyEvent({
      type: 'CardMovedEvent',
      payload: {
        cardId: 'c-forest', cardName: 'Forest', ownerId: ALICE,
        types: ['Land'], from: 'Hand', to: 'Graveyard',
      },
    });
    expect(store.landsPlayedThisTurn()).toBe(0);
  });

  it('resets on TurnStartedEvent', () => {
    store.applyEvent({
      type: 'CardMovedEvent',
      payload: {
        cardId: 'c-forest', cardName: 'Forest', ownerId: ALICE,
        types: ['Land'], from: 'Hand', to: 'Battlefield',
      },
    });
    expect(store.landsPlayedThisTurn()).toBe(1);
    store.applyEvent({
      type: 'TurnStartedEvent',
      payload: { turn: 2, playerId: BOB },
    });
    expect(store.landsPlayedThisTurn()).toBe(0);
  });

  it('reset() returns the counter to 0', () => {
    store.applyEvent({
      type: 'CardMovedEvent',
      payload: {
        cardId: 'c-forest', cardName: 'Forest', ownerId: ALICE,
        types: ['Land'], from: 'Hand', to: 'Battlefield',
      },
    });
    expect(store.landsPlayedThisTurn()).toBe(1);
    store.reset();
    expect(store.landsPlayedThisTurn()).toBe(0);
  });
});
