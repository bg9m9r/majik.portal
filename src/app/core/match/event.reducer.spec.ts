import { describe, expect, it } from 'vitest';
import { patchGameState } from './event.reducer';
import { NormalisedEventDto } from './event.types';
import { GameState } from './match.types';

// Minimal fixture — only the fields the reducer touches matter; zone
// shapes are stubbed since none of the patched event types reach into
// hands / battlefields / libraries.
const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function baseState(): GameState {
  return {
    gameId: 'g-1',
    phase: 'PreCombatMain',
    turnNumber: 3,
    activePlayerId: ALICE,
    players: [
      {
        id: ALICE, name: 'Alice', life: 20,
        mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
        hand: { cards: [] }, library: { cards: [] }, graveyard: { cards: [] },
        exile: { cards: [] }, battlefield: { cards: [] },
      },
      {
        id: BOB, name: 'Bob', life: 17,
        mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
        hand: { cards: [] }, library: { cards: [] }, graveyard: { cards: [] },
        exile: { cards: [] }, battlefield: { cards: [] },
      },
    ],
    stack: [],
  };
}

function evt(type: string, payload: Record<string, unknown>): NormalisedEventDto {
  return { eventId: 'e-1', type, payload };
}

describe('patchGameState', () => {
  describe('LifeChangedEvent', () => {
    it('updates the matched player life and leaves the other untouched', () => {
      const state = baseState();
      const next = patchGameState(state, evt('LifeChangedEvent', {
        playerId: BOB, previous: 17, current: 14,
      }));
      expect(next).not.toBeNull();
      expect(next!.players.find(p => p.id === BOB)!.life).toBe(14);
      expect(next!.players.find(p => p.id === ALICE)!.life).toBe(20);
      // Pure: original untouched
      expect(state.players.find(p => p.id === BOB)!.life).toBe(17);
    });

    it('returns null when playerId is unknown (signals refetch)', () => {
      const next = patchGameState(baseState(), evt('LifeChangedEvent', {
        playerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', current: 10,
      }));
      expect(next).toBeNull();
    });

    it('returns null when current life is missing', () => {
      const next = patchGameState(baseState(), evt('LifeChangedEvent', {
        playerId: ALICE,
      }));
      expect(next).toBeNull();
    });
  });

  describe('PhaseChangedEvent', () => {
    it('sets state.phase to payload.to', () => {
      const next = patchGameState(baseState(), evt('PhaseChangedEvent', {
        from: 'PreCombatMain', to: 'Combat',
      }));
      expect(next!.phase).toBe('Combat');
    });

    it('returns null without a `to` field', () => {
      expect(patchGameState(baseState(), evt('PhaseChangedEvent', { from: 'X' }))).toBeNull();
    });
  });

  describe('PhaseStartedEvent', () => {
    it('updates phase and follows the active player from payload', () => {
      const state = baseState();
      const next = patchGameState(state, evt('PhaseStartedEvent', {
        phase: 'Beginning', playerId: BOB,
      }));
      expect(next!.phase).toBe('Beginning');
      expect(next!.activePlayerId).toBe(BOB);
    });

    it('preserves activePlayerId when payload omits playerId', () => {
      const next = patchGameState(baseState(), evt('PhaseStartedEvent', {
        phase: 'PostCombatMain',
      }));
      expect(next!.activePlayerId).toBe(ALICE);
      expect(next!.phase).toBe('PostCombatMain');
    });
  });

  describe('StepStartedEvent', () => {
    it('writes the step label into state.phase (steps share that slot)', () => {
      const next = patchGameState(baseState(), evt('StepStartedEvent', {
        step: 'Upkeep', playerId: ALICE,
      }));
      expect(next!.phase).toBe('Upkeep');
    });
  });

  describe('TurnStartedEvent', () => {
    it('bumps turnNumber and active player when both are known', () => {
      const next = patchGameState(baseState(), evt('TurnStartedEvent', {
        turn: 4, playerId: BOB,
      }));
      expect(next!.turnNumber).toBe(4);
      expect(next!.activePlayerId).toBe(BOB);
    });

    it('returns null when active player is not in the snapshot', () => {
      const next = patchGameState(baseState(), evt('TurnStartedEvent', {
        turn: 4, playerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      }));
      expect(next).toBeNull();
    });
  });

  describe('PlayerLostEvent', () => {
    it('marks the matched player hasLost=true', () => {
      const next = patchGameState(baseState(), evt('PlayerLostEvent', {
        playerId: ALICE,
      }));
      expect(next!.players.find(p => p.id === ALICE)!.hasLost).toBe(true);
      expect(next!.players.find(p => p.id === BOB)!.hasLost).toBeFalsy();
    });
  });

  describe('SpellCastEvent', () => {
    it('appends a StackItem from the enriched payload', () => {
      const next = patchGameState(baseState(), evt('SpellCastEvent', {
        stackId: 's-bolt',
        controllerId: ALICE,
        cardId: 'c-bolt',
        cardName: 'Lightning Bolt',
        kind: 'Spell',
        description: 'Lightning Bolt',
      }));
      expect(next).not.toBeNull();
      expect(next!.stack).toHaveLength(1);
      expect(next!.stack[0]).toEqual({
        id: 's-bolt', kind: 'Spell', description: 'Lightning Bolt',
      });
    });

    it('returns null when required payload fields are missing', () => {
      // No kind / description means we can't reconstruct StackObjectDto.
      const next = patchGameState(baseState(), evt('SpellCastEvent', {
        stackId: 's-bolt', controllerId: ALICE, cardName: 'Lightning Bolt',
      }));
      expect(next).toBeNull();
    });
  });

  describe('StackObjectAddedEvent', () => {
    it('appends a StackItem for any IStackObject kind', () => {
      const next = patchGameState(baseState(), evt('StackObjectAddedEvent', {
        stackId: 's-trigger',
        controllerId: BOB,
        kind: 'TriggeredAbility',
        description: 'Ranger trigger',
      }));
      expect(next!.stack).toHaveLength(1);
      expect(next!.stack[0]).toEqual({
        id: 's-trigger', kind: 'TriggeredAbility', description: 'Ranger trigger',
      });
    });

    it('treats a duplicate stackId as an idempotent no-op (not a refetch)', () => {
      // SpellCastEvent + StackObjectAddedEvent both fire when a spell is
      // cast — the second one must NOT push a phantom StackItem, and
      // must NOT trigger a refetch.
      const seeded: GameState = {
        ...baseState(),
        stack: [{ id: 's-bolt', kind: 'Spell', description: 'Bolt' }],
      };
      const next = patchGameState(seeded, evt('StackObjectAddedEvent', {
        stackId: 's-bolt', controllerId: ALICE, kind: 'Spell', description: 'Bolt',
      }));
      expect(next).not.toBeNull();
      expect(next!.stack).toHaveLength(1);
    });
  });

  describe('StackObjectResolvedEvent', () => {
    it('removes the resolved item from state.stack', () => {
      const seeded: GameState = {
        ...baseState(),
        stack: [
          { id: 's-bolt', kind: 'Spell', description: 'Bolt' },
          { id: 's-counter', kind: 'Spell', description: 'Counterspell' },
        ],
      };
      const next = patchGameState(seeded, evt('StackObjectResolvedEvent', {
        stackId: 's-counter', controllerId: BOB, kind: 'Spell', description: 'Counterspell',
      }));
      expect(next!.stack).toEqual([
        { id: 's-bolt', kind: 'Spell', description: 'Bolt' },
      ]);
    });

    it('returns null when the resolved id isn’t on the snapshot stack', () => {
      // Stale snapshot — caller refetches.
      const next = patchGameState(baseState(), evt('StackObjectResolvedEvent', {
        stackId: 's-missing', kind: 'Spell', description: 'Anything',
      }));
      expect(next).toBeNull();
    });
  });

  describe('deferred / unknown events', () => {
    it('returns null for CardMovedEvent (would need battlefield card data)', () => {
      const next = patchGameState(baseState(), evt('CardMovedEvent', {
        cardId: 'x', cardName: 'Forest', from: 'Hand', to: 'Battlefield',
      }));
      expect(next).toBeNull();
    });

    it('returns null for any unknown event type', () => {
      const next = patchGameState(baseState(), evt('SomethingNobodyImplementedYet', {}));
      expect(next).toBeNull();
    });
  });

  it('tolerates PascalCase payload keys defensively', () => {
    const next = patchGameState(baseState(), evt('LifeChangedEvent', {
      PlayerId: BOB, Previous: 17, Current: 9,
    }));
    expect(next!.players.find(p => p.id === BOB)!.life).toBe(9);
  });
});
