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
    seq: 0,
  };
}

function evt(type: string, payload: Record<string, unknown>): NormalisedEventDto {
  return { eventId: 'e-1', type, payload, seq: 0 };
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

  describe('GameStateChangedEvent', () => {
    it('defers to a /state refetch (game-lifecycle channel, not structurally patched)', () => {
      // Initializing/Mulligan/Playing/GameOver must NOT touch the phase
      // label; the reducer returns null so the caller re-pulls the snapshot.
      const next = patchGameState(baseState(), evt('GameStateChangedEvent', {
        from: 'Mulligan', to: 'Playing',
      }));
      expect(next).toBeNull();
      expect(baseState().phase).not.toBe('Playing');
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
        controllerId: ALICE, cardName: 'Lightning Bolt',
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
        controllerId: BOB, cardName: null,
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

    it('patches a Hand→Battlefield ETB in place from the enriched payload (PLAN 04)', () => {
      // PLAN 04 — the revealed → Battlefield move now carries the full
      // permanent fields, so the ETB is applied in place instead of
      // forcing a refetch. The reducer output for the patched battlefield
      // zone must equal what a fresh /state snapshot returns for the card.
      const bear = knownCard('c-bear', 'Grizzly Bears');
      const seeded: GameState = {
        ...baseState(),
        players: baseState().players.map(p => p.id === ALICE
          ? { ...p, hand: { cards: [bear] } }
          : p),
      };
      // Payload shaped exactly like StateSnapshotter.BuildPermanentFields
      // emits on the revealed CardMovedEvent.
      const next = patchGameState(seeded, evt('CardMovedEvent', {
        cardId: 'c-bear', cardName: 'Grizzly Bears', ownerId: ALICE,
        manaCost: '1G', types: ['Creature'],
        from: 'Hand', to: 'Battlefield',
        power: 2, toughness: 2, tapped: false, summoningSickness: true,
        abilities: [{ kind: 'Static', description: 'static ability', id: null }],
        producedManaColors: '', counters: {},
      }));
      expect(next).not.toBeNull();
      const alice = next!.players.find(p => p.id === ALICE)!;
      expect(alice.hand.cards).toHaveLength(0);
      expect(alice.battlefield.cards).toHaveLength(1);

      const card = alice.battlefield.cards[0];
      // Reducer output == the fresh-/state CardSnapshot shape for this card.
      const expected: CardSnapshot = {
        instanceId: 'c-bear', name: 'Grizzly Bears', manaCost: '1G',
        types: ['Creature'], power: 2, toughness: 2, tapped: false,
        summoningSickness: true, producedManaColors: '',
        abilities: [{ kind: 'Static', description: 'static ability', id: null }],
        counters: {},
      };
      expect(card).toEqual(expected);
    });

    it('reads counters on a Battlefield ETB into the patched snapshot', () => {
      const hydra = knownCard('c-hydra', 'Counter Hydra');
      const seeded: GameState = {
        ...baseState(),
        players: baseState().players.map(p => p.id === ALICE
          ? { ...p, hand: { cards: [hydra] } }
          : p),
      };
      const next = patchGameState(seeded, evt('CardMovedEvent', {
        cardId: 'c-hydra', cardName: 'Counter Hydra', ownerId: ALICE,
        manaCost: '2GG', types: ['Creature'],
        from: 'Hand', to: 'Battlefield',
        power: 0, toughness: 0, tapped: false, summoningSickness: true,
        producedManaColors: '', counters: { '+1/+1': 3 },
      }));
      const card = next!.players.find(p => p.id === ALICE)!.battlefield.cards[0];
      expect(card.counters).toEqual({ '+1/+1': 3 });
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

  describe('CounterAddedEvent (PLAN 04)', () => {
    it('bumps the target permanent\'s counter badge on the battlefield', () => {
      const ballista = knownCard('c-ballista', 'Walking Ballista', {
        types: ['Creature'], power: 2, toughness: 2, counters: { '+1/+1': 2 },
      });
      const seeded: GameState = {
        ...baseState(),
        players: baseState().players.map(p => p.id === ALICE
          ? { ...p, battlefield: { cards: [ballista] } }
          : p),
      };
      const next = patchGameState(seeded, evt('CounterAddedEvent', {
        targetInstanceId: 'c-ballista', counterType: '+1/+1', amount: 1,
        controllerId: ALICE,
      }));
      expect(next).not.toBeNull();
      const card = next!.players.find(p => p.id === ALICE)!.battlefield.cards[0];
      // Display-only badge bumped 2 → 3.
      expect(card.counters).toEqual({ '+1/+1': 3 });
      // P/T are NOT recomputed in the reducer (authoritative from snapshot).
      expect(card.power).toBe(2);
      expect(card.toughness).toBe(2);
    });

    it('initialises the counter map when the card had none', () => {
      const bear = knownCard('c-bear', 'Bear', { types: ['Creature'], power: 2, toughness: 2 });
      const seeded: GameState = {
        ...baseState(),
        players: baseState().players.map(p => p.id === ALICE
          ? { ...p, battlefield: { cards: [bear] } }
          : p),
      };
      const next = patchGameState(seeded, evt('CounterAddedEvent', {
        targetInstanceId: 'c-bear', counterType: 'Charge', amount: 2, controllerId: ALICE,
      }));
      const card = next!.players.find(p => p.id === ALICE)!.battlefield.cards[0];
      expect(card.counters).toEqual({ Charge: 2 });
    });

    it('returns null when the target is not on any battlefield (stale snapshot)', () => {
      const next = patchGameState(baseState(), evt('CounterAddedEvent', {
        targetInstanceId: 'ghost', counterType: '+1/+1', amount: 1, controllerId: ALICE,
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

  describe('ContinuousEffect add/remove (log-only)', () => {
    it('treats ContinuousEffect add/remove as handled no-ops (no refetch)', () => {
      const s = baseState();
      // Log-only events: consumed by describeEvent, no snapshot delta.
      // Returns the same state object so applyEvent reports success and
      // does NOT trigger a /state refetch on every layer mutation.
      expect(patchGameState(s, evt('ContinuousEffectAddedEvent', {}))).toBe(s);
      expect(patchGameState(s, evt('ContinuousEffectRemovedEvent', {}))).toBe(s);
    });
  });

  describe('deferred / unknown events', () => {
    it('returns null for any unknown event type', () => {
      const next = patchGameState(baseState(), evt('SomethingNobodyImplementedYet', {}));
      expect(next).toBeNull();
    });
  });

  // PLAN 07 — the INNER payload keys are now camelCase-only (the server
  // serializes typed *Payload records through a single CamelCase policy),
  // so the reducer reads camelCase and no longer hedges on PascalCase
  // inner keys. The OUTER-envelope casing tolerance still lives in
  // normaliseEvent (covered by event.types.spec.ts).
  it('reads camelCase payload keys (typed wire contract)', () => {
    const next = patchGameState(baseState(), evt('LifeChangedEvent', {
      playerId: BOB, previous: 17, current: 9,
    }));
    expect(next!.players.find(p => p.id === BOB)!.life).toBe(9);
  });

  it('does NOT read PascalCase inner payload keys (hedge removed)', () => {
    // A PascalCase inner payload no longer matches — the reducer signals a
    // refetch (null) rather than silently mis-patching. This guards the
    // intentional removal of the inner Pascal fallback.
    const next = patchGameState(baseState(), evt('LifeChangedEvent', {
      PlayerId: BOB, Previous: 17, Current: 9,
    }));
    expect(next).toBeNull();
  });
});
