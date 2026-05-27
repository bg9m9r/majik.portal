import { describe, expect, it } from 'vitest';
import { patchGameState } from './event.reducer';
import { NormalisedEventDto } from './event.types';
import { CardSnapshot, GameState } from './match.types';

const HIDDEN_INSTANCE_ID = '00000000-0000-0000-0000-000000000000';
const HIDDEN_NAME = '(hidden)';

function hiddenCard(): CardSnapshot {
  return {
    instanceId: HIDDEN_INSTANCE_ID, name: HIDDEN_NAME, manaCost: '', types: [],
    power: null, toughness: null, tapped: false, summoningSickness: false,
    producedManaColors: '',
  };
}

function knownCard(instanceId: string, name: string, opts: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    instanceId, name, manaCost: '', types: [],
    power: null, toughness: null, tapped: false, summoningSickness: false,
    producedManaColors: '',
    ...opts,
  };
}

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
    youPlayerId: null,
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

  // -----------------------------------------------------------------
  // CardMovedEvent — server emits enriched payload + per-viewer mask.
  // Coverage walks the key transitions (revealed + masked) and asserts
  // the destination zone receives either a full CardSnapshot or the
  // (hidden) placeholder, matching StateSnapshotter.HiddenZone.
  // -----------------------------------------------------------------
  describe('CardMovedEvent', () => {
    it('moves a revealed card from hand to graveyard', () => {
      const bolt = knownCard('c-bolt', 'Lightning Bolt', { manaCost: 'R', types: ['Instant'] });
      const seeded: GameState = {
        ...baseState(),
        players: baseState().players.map(p => p.id === ALICE
          ? { ...p, hand: { cards: [bolt] } }
          : p),
      };
      const next = patchGameState(seeded, evt('CardMovedEvent', {
        cardId: 'c-bolt', cardName: 'Lightning Bolt', ownerId: ALICE,
        manaCost: 'R', types: ['Instant'],
        from: 'Hand', to: 'Graveyard',
      }));
      expect(next).not.toBeNull();
      const alice = next!.players.find(p => p.id === ALICE)!;
      expect(alice.hand.cards).toHaveLength(0);
      expect(alice.graveyard.cards).toHaveLength(1);
      expect(alice.graveyard.cards[0].name).toBe('Lightning Bolt');
      expect(alice.graveyard.cards[0].manaCost).toBe('R');
      expect(alice.graveyard.cards[0].types).toEqual(['Instant']);
    });

    it('returns null when destination is Battlefield (needs richer card data)', () => {
      // Battlefield needs P/T, tapped, summoning sickness, abilities —
      // none of which travel on CardMovedEvent. Refetch.
      const bolt = knownCard('c-bear', 'Grizzly Bears');
      const seeded: GameState = {
        ...baseState(),
        players: baseState().players.map(p => p.id === ALICE
          ? { ...p, hand: { cards: [bolt] } }
          : p),
      };
      const next = patchGameState(seeded, evt('CardMovedEvent', {
        cardId: 'c-bear', cardName: 'Grizzly Bears', ownerId: ALICE,
        from: 'Hand', to: 'Battlefield',
      }));
      expect(next).toBeNull();
    });

    it('treats Stack as already-handled (no double-patch)', () => {
      // SpellCast / StackObject* events already moved the stack — the
      // CardMovedEvent shouldn't blip the hand count again.
      const bolt = knownCard('c-bolt', 'Lightning Bolt');
      const seeded: GameState = {
        ...baseState(),
        players: baseState().players.map(p => p.id === ALICE
          ? { ...p, hand: { cards: [bolt] } }
          : p),
      };
      const next = patchGameState(seeded, evt('CardMovedEvent', {
        cardId: 'c-bolt', cardName: 'Lightning Bolt', ownerId: ALICE,
        from: 'Hand', to: 'Stack',
      }));
      // No-op patch: state returned as-is (caller MUST NOT refetch).
      expect(next).not.toBeNull();
      const alice = next!.players.find(p => p.id === ALICE)!;
      expect(alice.hand.cards).toHaveLength(1);
    });

    describe('masked moves (CR 706)', () => {
      it('adds a (hidden) placeholder to the owner\'s hand for a masked draw', () => {
        // Library → Hand masked from opponent: portal patches by popping
        // a library placeholder and pushing a (hidden) placeholder into
        // the owner's hand, keeping zone counts accurate without
        // leaking card identity.
        const seeded: GameState = {
          ...baseState(),
          players: baseState().players.map(p => p.id === BOB
            ? { ...p, library: { cards: [hiddenCard(), hiddenCard(), hiddenCard()] } }
            : p),
        };
        const next = patchGameState(seeded, evt('CardMovedEvent', {
          ownerId: BOB, from: 'Library', to: 'Hand', hidden: true,
        }));
        expect(next).not.toBeNull();
        const bob = next!.players.find(p => p.id === BOB)!;
        expect(bob.library.cards).toHaveLength(2);
        expect(bob.hand.cards).toHaveLength(1);
        expect(bob.hand.cards[0].instanceId).toBe(HIDDEN_INSTANCE_ID);
        expect(bob.hand.cards[0].name).toBe(HIDDEN_NAME);
      });

      it('removes a placeholder from hand for a masked Hand→Library (return to library)', () => {
        const seeded: GameState = {
          ...baseState(),
          players: baseState().players.map(p => p.id === BOB
            ? { ...p, hand: { cards: [hiddenCard(), hiddenCard()] }, library: { cards: [hiddenCard()] } }
            : p),
        };
        const next = patchGameState(seeded, evt('CardMovedEvent', {
          ownerId: BOB, from: 'Hand', to: 'Library', hidden: true,
        }));
        expect(next).not.toBeNull();
        const bob = next!.players.find(p => p.id === BOB)!;
        expect(bob.hand.cards).toHaveLength(1);
        expect(bob.library.cards).toHaveLength(2);
        // No revealed card name surfaces on opponent's side.
        expect(bob.library.cards.every(c => c.name === HIDDEN_NAME)).toBe(true);
      });

      it('does NOT include card identity in the masked patch path', () => {
        // Even if (defensively) a stray cardName slipped into a masked
        // payload, the hidden discriminator MUST win and the inserted
        // card stays a placeholder. CR 706 strict gate.
        const seeded: GameState = {
          ...baseState(),
          players: baseState().players.map(p => p.id === BOB
            ? { ...p, library: { cards: [hiddenCard()] } }
            : p),
        };
        const next = patchGameState(seeded, evt('CardMovedEvent', {
          ownerId: BOB, from: 'Library', to: 'Hand', hidden: true,
          // Adversarially-injected reveal data — must be ignored.
          cardId: 'leak-id', cardName: 'Black Lotus',
        }));
        const bob = next!.players.find(p => p.id === BOB)!;
        expect(bob.hand.cards[0].name).toBe(HIDDEN_NAME);
        expect(bob.hand.cards[0].instanceId).toBe(HIDDEN_INSTANCE_ID);
      });

      it('returns null when the source zone has nothing to remove (stale snapshot)', () => {
        // Library masked draw but viewer's library snapshot is empty —
        // a refetch is the only way to recover the correct count.
        const next = patchGameState(baseState(), evt('CardMovedEvent', {
          ownerId: BOB, from: 'Library', to: 'Hand', hidden: true,
        }));
        expect(next).toBeNull();
      });
    });

    it('returns null when ownerId is missing', () => {
      const next = patchGameState(baseState(), evt('CardMovedEvent', {
        cardId: 'x', cardName: 'X', from: 'Hand', to: 'Graveyard',
      }));
      expect(next).toBeNull();
    });

    it('returns null when source card isn\'t in the snapshot (stale)', () => {
      const next = patchGameState(baseState(), evt('CardMovedEvent', {
        cardId: 'missing', cardName: 'Ghost', ownerId: ALICE,
        from: 'Hand', to: 'Graveyard',
      }));
      expect(next).toBeNull();
    });
  });

  describe('CardDrawnEvent', () => {
    it('is a no-op (CardMovedEvent already described the transition) and does not signal refetch', () => {
      // Engine fires CardMovedEvent(Library, Hand) followed by
      // CardDrawnEvent. Patching both would double-add to the hand.
      const state = baseState();
      const next = patchGameState(state, evt('CardDrawnEvent', {
        playerId: ALICE, hidden: true,
      }));
      // Same state object → caller does NOT refetch.
      expect(next).toBe(state);
    });
  });

  describe('deferred / unknown events', () => {
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
