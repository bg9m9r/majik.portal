import { describe, expect, it } from 'vitest';
import { describeEvent } from './log.types';
import { NormalisedEventDto } from './event.types';
import { GameState } from './match.types';

function evt(type: string, payload: Record<string, unknown>, seq = 1): NormalisedEventDto {
  return { eventId: 'e', type, payload, seq };
}
const SELF = ['p1'];
function state(over: Partial<GameState> = {}): GameState {
  return {
    players: [
      { id: 'p1', name: 'You', life: 20 } as any,
      { id: 'p2', name: 'Bot', life: 20 } as any,
    ],
    stack: [], turnNumber: 1, phase: 'PreCombatMain', activePlayerId: 'p1',
    youPlayerId: null,
    ...(over as any),
  } as GameState;
}

describe('describeEvent', () => {
  it('describes a cast', () => {
    const line = describeEvent(
      evt('SpellCastEvent', { description: 'Lightning Bolt', controllerId: 'p1' }),
      state(), state(), SELF);
    expect(line?.kind).toBe('cast');
    expect(line?.text).toContain('Lightning Bolt');
    expect(line?.actorId).toBe('p1');
  });

  it('splits activated vs triggered on kind', () => {
    const act = describeEvent(
      evt('StackObjectAddedEvent', { kind: 'activated', description: 'Walking Ballista: ping' }),
      state(), state(), SELF);
    expect(act?.kind).toBe('activate');
    const trig = describeEvent(
      evt('StackObjectAddedEvent', { kind: 'triggered', description: 'Young Wolf undying' }),
      state(), state(), SELF);
    expect(trig?.kind).toBe('trigger');
  });

  it('skips the spell variant of StackObjectAddedEvent (SpellCast already logged it)', () => {
    const spell = describeEvent(
      evt('StackObjectAddedEvent', { kind: 'spell', description: 'Lightning Bolt' }),
      state(), state(), SELF);
    expect(spell).toBeNull();
  });

  it('describes a continuous-effect add/remove', () => {
    const add = describeEvent(
      evt('ContinuousEffectAddedEvent', {
        sourceName: 'Goblin Chieftain', description: 'Goblin Chieftain effect', layer: 'PowerToughness',
      }), state(), state(), SELF);
    expect(add?.kind).toBe('layer');
    expect(add?.text).toContain('Goblin Chieftain');
    const rem = describeEvent(
      evt('ContinuousEffectRemovedEvent', {
        sourceName: 'Goblin Chieftain', description: 'Goblin Chieftain effect', layer: 'PowerToughness',
      }), state(), state(), SELF);
    expect(rem?.kind).toBe('layer');
    expect(rem?.text).toMatch(/removed|wears off|ends/i);
  });

  it('logs only ETB / death / exile CardMoved, never hidden', () => {
    const etb = describeEvent(
      evt('CardMovedEvent', { to: 'Battlefield', from: 'Hand', cardName: 'Bear', ownerId: 'p1' }),
      state(), state(), SELF);
    expect(etb?.kind).toBe('zone');
    const draw = describeEvent(
      evt('CardMovedEvent', { to: 'Hand', from: 'Library', hidden: true }),
      state(), state(), SELF);
    expect(draw).toBeNull();
  });

  it('describes life change using the payload current value (pre-patch correct)', () => {
    // prev == next == current pre-patch; the after must come from the payload.
    const line = describeEvent(
      evt('LifeChangedEvent', { playerId: 'p2', current: 17 }),
      state(), state(), SELF);
    expect(line?.kind).toBe('life');
    expect(line?.text).toContain('17');
    expect(line?.text).toMatch(/-3/);
  });

  it('skips noise (returns null)', () => {
    expect(describeEvent(evt('CardDrawnEvent', {}), state(), state(), SELF)).toBeNull();
  });
});
