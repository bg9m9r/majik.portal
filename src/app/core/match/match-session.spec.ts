import { describe, expect, it } from 'vitest';
import {
  AutoPassDeps,
  STACK_MUTATION_DISPLAY_MS,
  autoPassPromptKey,
  shouldAutoPass,
  stackSignature,
} from './match-session';
import { CardSnapshot, GameState, PromptEnvelope } from './match.types';

// ---------------------------------------------------------------------
// shouldAutoPass + stackSignature — pure match-session logic. These
// tests were moved here from routes/match/match.spec.ts when the logic
// was lifted out of MatchPage into the shared match-session module
// (Slice 2b). The store-level integration (shouldAutoPassNow / runAutoPass)
// is covered in game.store.spec.ts.
// ---------------------------------------------------------------------

const ME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OPP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function land(id = 'forest'): CardSnapshot {
  return {
    instanceId: id, name: 'Forest', manaCost: '', types: ['Land', 'Basic'],
    power: null, toughness: null, tapped: false, summoningSickness: false,
    producedManaColors: '',
  };
}

function spell(id = 'bolt'): CardSnapshot {
  return {
    instanceId: id, name: 'Lightning Bolt', manaCost: '{R}', types: ['Instant'],
    power: null, toughness: null, tapped: false, summoningSickness: false,
    producedManaColors: '',
  };
}

function state(over: Partial<GameState> & {
  hand?: CardSnapshot[];
  activePlayer?: 'me' | 'opp';
} = {}): GameState {
  const { hand = [], activePlayer = 'me', ...rest } = over;
  const empty = { cards: [] };
  return {
    gameId: 'g-1',
    phase: 'PreCombatMain',
    turnNumber: 1,
    activePlayerId: activePlayer === 'me' ? ME : OPP,
    players: [
      {
        id: ME, name: 'Me', life: 20,
        mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
        hand: { cards: hand },
        library: empty, graveyard: empty, exile: empty, battlefield: empty,
      },
      {
        id: OPP, name: 'Opp', life: 20,
        mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
        hand: empty, library: empty, graveyard: empty, exile: empty, battlefield: empty,
      },
    ],
    stack: [],
    youPlayerId: null,
    ...rest,
  };
}

function deps(over: Partial<AutoPassDeps> = {}): AutoPassDeps {
  return {
    state: state(),
    selfPlayerIds: [ME],
    phaseStops: {},
    fullControl: false,
    lastStackMutatedAt: null,
    nowMs: 1_000_000_000,
    ...over,
  };
}

const PASS_ONLY_PROMPT: PromptEnvelope = {
  gameId: 'g-1', playerId: ME, expectedKinds: ['PassPriorityCommand'],
};

const PASS_OR_ACT_PROMPT: PromptEnvelope = {
  gameId: 'g-1', playerId: ME,
  expectedKinds: ['PassPriorityCommand', 'PlayLandCommand', 'CastSpellCommand'],
};

describe('shouldAutoPass — auto-pass guard', () => {
  it('non-priority prompts (targets/mulligan/etc.) never auto-pass', () => {
    const targetsPrompt: PromptEnvelope = { ...PASS_ONLY_PROMPT, expectedKinds: ['targets'] };
    expect(shouldAutoPass(targetsPrompt, deps())).toBe(false);
  });

  it('multi-kind priority prompt (pass + play-land + cast) → never auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [spell()] });
    expect(shouldAutoPass(PASS_OR_ACT_PROMPT, deps({ state: s }))).toBe(false);
  });

  it('two-kind priority prompt (pass + play-land) → never auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [land()] });
    const prompt: PromptEnvelope = {
      ...PASS_ONLY_PROMPT,
      expectedKinds: ['PassPriorityCommand', 'PlayLandCommand'],
    };
    expect(shouldAutoPass(prompt, deps({ state: s }))).toBe(false);
  });

  it('empty expectedKinds → never auto-pass (engine must explicitly say "pass only")', () => {
    const emptyPrompt: PromptEnvelope = { ...PASS_ONLY_PROMPT, expectedKinds: [] };
    expect(shouldAutoPass(emptyPrompt, deps())).toBe(false);
  });

  it('no GameState yet → never auto-pass', () => {
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: null }))).toBe(false);
  });

  it('empty selfPlayerIds (race: prompt before /state) → never auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [spell()] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s, selfPlayerIds: [] }))).toBe(false);
  });

  it('stack non-empty → never auto-pass (CR 117.3b response window)', () => {
    const s = state();
    s.stack = [{ id: 's1', kind: 'Spell', description: 'Lightning Bolt' }];
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s }))).toBe(false);
  });

  it('viewer main phase + pass-only prompt → auto-pass (engine signalled no actions)', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s }))).toBe(true);
  });

  it('phase-stop for the active side wins → never auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'Untap', hand: [] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s, phaseStops: { Untap: 'mine' } }))).toBe(false);
  });

  it('phase-stop for the other side does NOT block auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'Untap', hand: [] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s, phaseStops: { Untap: 'theirs' } }))).toBe(true);
  });

  it('opponent combat + non-land in viewer hand → never auto-pass', () => {
    const s = state({ activePlayer: 'opp', phase: 'DeclareAttackers', hand: [spell()] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s }))).toBe(false);
  });

  it('opponent combat + land-only viewer hand → auto-pass', () => {
    const s = state({ activePlayer: 'opp', phase: 'DeclareAttackers', hand: [land()] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s }))).toBe(true);
  });

  it('opponent non-combat phase + non-land in hand → auto-pass (no instant window guarded here)', () => {
    const s = state({ activePlayer: 'opp', phase: 'Draw', hand: [spell()] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s }))).toBe(true);
  });

  it('Full Control suppresses auto-pass even when every other guard would clear', () => {
    const s = state({ activePlayer: 'opp', phase: 'Draw', hand: [land()] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s, fullControl: false }))).toBe(true);
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s, fullControl: true }))).toBe(false);
  });

  it('stack mutated <600ms ago → never auto-pass (minimum-display window)', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [] });
    const now = 5_000;
    const d = deps({ state: s, lastStackMutatedAt: now - 200, nowMs: now });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, d)).toBe(false);
  });

  it('stack mutated exactly at window boundary → still suppressed', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [] });
    const now = 5_000;
    const d = deps({ state: s, lastStackMutatedAt: now - (STACK_MUTATION_DISPLAY_MS - 1), nowMs: now });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, d)).toBe(false);
  });

  it('stack mutated >600ms ago + pass-only prompt → auto-pass clears', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [] });
    const now = 5_000;
    const d = deps({ state: s, lastStackMutatedAt: now - (STACK_MUTATION_DISPLAY_MS + 50), nowMs: now });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, d)).toBe(true);
  });

  it('lastStackMutatedAt null (page-load default) → no timer block', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [] });
    const d = deps({ state: s, lastStackMutatedAt: null, nowMs: 5_000 });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, d)).toBe(true);
  });

  it('stack mutation window suppresses even when stack is non-empty too', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [] });
    s.stack = [{ id: 's1', kind: 'TriggeredAbility', description: 'ETB trigger' }];
    const now = 5_000;
    const d = deps({ state: s, lastStackMutatedAt: now - 100, nowMs: now });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, d)).toBe(false);
  });
});

describe('stackSignature', () => {
  it('returns the same sentinel for null and empty stacks', () => {
    expect(stackSignature(null)).toBe('0|');
    expect(stackSignature(state())).toBe('0|');
  });

  it('differs when an item is added', () => {
    const empty = state();
    const oneItem = state();
    oneItem.stack = [{ id: 's1', kind: 'TriggeredAbility', description: 't' }];
    expect(stackSignature(empty)).not.toBe(stackSignature(oneItem));
  });

  it('differs when an item is replaced (resolve + new arrival)', () => {
    const a = state();
    a.stack = [{ id: 's1', kind: 'TriggeredAbility', description: 'a' }];
    const b = state();
    b.stack = [{ id: 's2', kind: 'TriggeredAbility', description: 'b' }];
    expect(stackSignature(a)).not.toBe(stackSignature(b));
  });

  it('matches across re-renders of the same stack', () => {
    const a = state();
    a.stack = [
      { id: 's1', kind: 'TriggeredAbility', description: 'a' },
      { id: 's2', kind: 'Spell', description: 'b' },
    ];
    const b = state();
    b.stack = [
      { id: 's1', kind: 'TriggeredAbility', description: 'a' },
      { id: 's2', kind: 'Spell', description: 'b' },
    ];
    expect(stackSignature(a)).toBe(stackSignature(b));
  });
});

describe('autoPassPromptKey — stable de-dupe key', () => {
  it('is stable across fresh prompt objects with the same logical content', () => {
    const a: PromptEnvelope = { gameId: 'g', playerId: ME, expectedKinds: ['PassPriorityCommand'] };
    const b: PromptEnvelope = { gameId: 'g', playerId: ME, expectedKinds: ['PassPriorityCommand'] };
    expect(autoPassPromptKey(a)).toBe(autoPassPromptKey(b));
  });

  it('differs when the player or expected kinds differ', () => {
    const base: PromptEnvelope = { gameId: 'g', playerId: ME, expectedKinds: ['PassPriorityCommand'] };
    expect(autoPassPromptKey(base)).not.toBe(
      autoPassPromptKey({ ...base, playerId: OPP }));
    expect(autoPassPromptKey(base)).not.toBe(
      autoPassPromptKey({ ...base, expectedKinds: ['PassPriorityCommand', 'PlayLandCommand'] }));
  });
});
