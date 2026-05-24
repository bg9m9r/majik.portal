import { describe, expect, it, vi } from 'vitest';
import { AutoPassDeps, dispatchMatchKey, MatchKeyDeps, shouldAutoPass } from './match';
import { CardSnapshot, GameState, PromptEnvelope } from '../../core/match/match.types';

function card(id: string): CardSnapshot {
  return {
    instanceId: id,
    name: id,
    manaCost: '',
    types: ['Creature'],
    power: 1,
    toughness: 1,
    tapped: false,
    summoningSickness: false,
  };
}

function makeDeps(overrides: Partial<MatchKeyDeps> = {}): MatchKeyDeps {
  return {
    hasActionPrompt: () => true,
    hasPrompt: () => true,
    isMyTurnPrompt: () => true,
    handCards: () => [],
    pass: () => undefined,
    cancelPrompt: () => undefined,
    confirmPrimary: () => true,
    playHandCard: () => undefined,
    ...overrides,
  };
}

function ev(key: string, init: KeyboardEventInit = {}, code = ''): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
  // jsdom KeyboardEvent doesn't always honour `code` via init — set it
  // explicitly so the numpad-vs-digit-row filter is exercised.
  if (code) Object.defineProperty(e, 'code', { value: code });
  else Object.defineProperty(e, 'code', { value: '' });
  return e;
}

describe('dispatchMatchKey — match-page keyboard shortcuts', () => {
  it('Space passes priority when an action prompt is active', () => {
    const pass = vi.fn();
    const e = ev(' ');
    const preventSpy = vi.spyOn(e, 'preventDefault');
    dispatchMatchKey(e, makeDeps({ pass }));
    expect(pass).toHaveBeenCalledTimes(1);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('Space is a no-op when no action prompt is active', () => {
    const pass = vi.fn();
    const e = ev(' ');
    const preventSpy = vi.spyOn(e, 'preventDefault');
    dispatchMatchKey(e, makeDeps({ pass, hasActionPrompt: () => false }));
    expect(pass).not.toHaveBeenCalled();
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it('Escape cancels the prompt when one is open', () => {
    const cancelPrompt = vi.fn();
    const e = ev('Escape');
    dispatchMatchKey(e, makeDeps({ cancelPrompt }));
    expect(cancelPrompt).toHaveBeenCalledTimes(1);
  });

  it('Escape is a no-op when no prompt is open', () => {
    const cancelPrompt = vi.fn();
    const e = ev('Escape');
    dispatchMatchKey(e, makeDeps({ cancelPrompt, hasPrompt: () => false }));
    expect(cancelPrompt).not.toHaveBeenCalled();
  });

  it('Enter confirms primary when overlay is open and viewer-owned', () => {
    const confirmPrimary = vi.fn(() => true);
    const e = ev('Enter');
    const preventSpy = vi.spyOn(e, 'preventDefault');
    dispatchMatchKey(e, makeDeps({ confirmPrimary }));
    expect(confirmPrimary).toHaveBeenCalledTimes(1);
    expect(preventSpy).toHaveBeenCalled();
  });

  it('digit 1-9 plays the Nth hand card (zero-indexed mentally)', () => {
    const playHandCard = vi.fn();
    const cards = [card('a'), card('b'), card('c')];
    const e = ev('2', {}, 'Digit2');
    dispatchMatchKey(e, makeDeps({ playHandCard, handCards: () => cards }));
    expect(playHandCard).toHaveBeenCalledWith(cards[1]);
  });

  it('digit beyond hand length is a no-op', () => {
    const playHandCard = vi.fn();
    const cards = [card('only')];
    const e = ev('5', {}, 'Digit5');
    dispatchMatchKey(e, makeDeps({ playHandCard, handCards: () => cards }));
    expect(playHandCard).not.toHaveBeenCalled();
  });

  it('numpad digits are ignored (only top-row 1-9 binds to hand cards)', () => {
    const playHandCard = vi.fn();
    const cards = [card('a'), card('b')];
    const e = ev('1', {}, 'Numpad1');
    dispatchMatchKey(e, makeDeps({ playHandCard, handCards: () => cards }));
    expect(playHandCard).not.toHaveBeenCalled();
  });

  it('bails on a focused input (does not fire shortcuts while typing)', () => {
    const pass = vi.fn();
    const playHandCard = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
    Object.defineProperty(e, 'target', { value: input });
    Object.defineProperty(e, 'code', { value: '' });
    dispatchMatchKey(e, makeDeps({ pass, playHandCard, handCards: () => [card('a')] }));
    expect(pass).not.toHaveBeenCalled();
    expect(playHandCard).not.toHaveBeenCalled();
    input.remove();
  });

  it('Enter is a no-op when the overlay belongs to the opponent', () => {
    const confirmPrimary = vi.fn(() => true);
    const e = ev('Enter');
    dispatchMatchKey(e, makeDeps({ confirmPrimary, isMyTurnPrompt: () => false }));
    expect(confirmPrimary).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// shouldAutoPass — auto-pass guard (pure decision logic)
// ---------------------------------------------------------------------

const ME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OPP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function land(id = 'forest'): CardSnapshot {
  return {
    instanceId: id,
    name: 'Forest',
    manaCost: '',
    types: ['Land', 'Basic'],
    power: null,
    toughness: null,
    tapped: false,
    summoningSickness: false,
  };
}

function spell(id = 'bolt'): CardSnapshot {
  return {
    instanceId: id,
    name: 'Lightning Bolt',
    manaCost: '{R}',
    types: ['Instant'],
    power: null,
    toughness: null,
    tapped: false,
    summoningSickness: false,
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
    ...rest,
  };
}

function deps(over: Partial<AutoPassDeps> = {}): AutoPassDeps {
  return {
    state: state(),
    selfPlayerIds: [ME],
    phaseStops: {},
    ...over,
  };
}

// Primary auto-pass gate: engine signalled PassPriority is the SOLE
// legal action. Any other kind in the array (PlayLand, CastSpell,
// ActivateAbility, …) means the viewer has a choice to make.
const PASS_ONLY_PROMPT: PromptEnvelope = {
  gameId: 'g-1', playerId: ME, expectedKinds: ['PassPriorityCommand'],
};

// Realistic priority round the engine sends today — pass + play land
// + cast spell are all offered regardless of board state (see
// `Majik.Core.Api/RemoteAgent.cs#ChoosePriorityActionAsync`). With the
// new gate this prompt must NEVER auto-pass: the user can play a land
// or cast a spell so they must see the prompt.
const PASS_OR_ACT_PROMPT: PromptEnvelope = {
  gameId: 'g-1', playerId: ME,
  expectedKinds: ['PassPriorityCommand', 'PlayLandCommand', 'CastSpellCommand'],
};

describe('shouldAutoPass — auto-pass guard', () => {
  it('non-priority prompts (targets/mulligan/etc.) never auto-pass', () => {
    const targetsPrompt: PromptEnvelope = { ...PASS_ONLY_PROMPT, expectedKinds: ['targets'] };
    expect(shouldAutoPass(targetsPrompt, deps())).toBe(false);
  });

  // -----------------------------------------------------------------
  // Primary gate — exactly one kind, and it's PassPriority.
  // -----------------------------------------------------------------

  it('multi-kind priority prompt (pass + play-land + cast) → never auto-pass', () => {
    // Regression: the screenshot bug. Even on the viewer's main phase
    // with no lands in hand (all old guards would've auto-passed), the
    // engine signalled the user can still cast a spell — so we must
    // surface the prompt.
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

  // -----------------------------------------------------------------
  // Defence-in-depth guards (run only after primary gate matches).
  // -----------------------------------------------------------------

  it('no GameState yet → never auto-pass', () => {
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: null }))).toBe(false);
  });

  it('empty selfPlayerIds (race: prompt before /state) → never auto-pass', () => {
    // Conservative: without selfPlayerIds we can't classify the active
    // side, so bias toward surfacing the prompt.
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [spell()] });
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s, selfPlayerIds: [] }))).toBe(false);
  });

  it('stack non-empty → never auto-pass (CR 117.3b response window)', () => {
    const s = state();
    s.stack = [{ id: 's1', kind: 'Spell', description: 'Lightning Bolt' }];
    expect(shouldAutoPass(PASS_ONLY_PROMPT, deps({ state: s }))).toBe(false);
  });

  it('viewer main phase + pass-only prompt → auto-pass (engine signalled no actions)', () => {
    // With single-kind gate, the old "spell-only hand" / "no land in
    // hand" sub-cases collapse into "engine said pass-only" → trust it.
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
});
