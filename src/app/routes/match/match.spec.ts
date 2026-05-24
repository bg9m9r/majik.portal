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
    landsPlayedThisTurn: 0,
    fullControl: false,
    ...over,
  };
}

const PASS_PROMPT: PromptEnvelope = { gameId: 'g-1', playerId: ME, expectedKinds: [] };

describe('shouldAutoPass — auto-pass guard', () => {
  it('non-priority prompts (targets/mulligan/etc.) never auto-pass', () => {
    const targetsPrompt: PromptEnvelope = { ...PASS_PROMPT, expectedKinds: ['targets'] };
    expect(shouldAutoPass(targetsPrompt, deps())).toBe(false);
  });

  it('no GameState yet → never auto-pass', () => {
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: null }))).toBe(false);
  });

  it('empty selfPlayerIds (race: prompt before /state) → never auto-pass', () => {
    // Regression: previously activeSide always resolved to "theirs" when
    // selfPlayerIds was empty, which bypassed the main-phase guard and
    // silently passed through the viewer's own main phases.
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [spell()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s, selfPlayerIds: [] }))).toBe(false);
  });

  it('stack non-empty → never auto-pass (CR 117.3b response window)', () => {
    const s = state();
    s.stack = [{ id: 's1', kind: 'Spell', description: 'Lightning Bolt' }];
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s }))).toBe(false);
  });

  it('viewer main phase + land in hand + 0 lands played → never auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [land()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s, landsPlayedThisTurn: 0 }))).toBe(false);
  });

  it('viewer main phase + no lands in hand → auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s }))).toBe(true);
  });

  it('viewer main phase + spell-only hand → auto-pass (no playable land)', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [spell()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s }))).toBe(true);
  });

  it('viewer main phase + land in hand + already played a land → auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'PreCombatMain', hand: [land()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s, landsPlayedThisTurn: 1 }))).toBe(true);
  });

  it('viewer PostCombatMain + land in hand + 0 lands played → never auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'PostCombatMain', hand: [land()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s }))).toBe(false);
  });

  it('phase-stop for the active side wins → never auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'Untap', hand: [] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s, phaseStops: { Untap: 'mine' } }))).toBe(false);
  });

  it('phase-stop for the other side does NOT block auto-pass', () => {
    const s = state({ activePlayer: 'me', phase: 'Untap', hand: [] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s, phaseStops: { Untap: 'theirs' } }))).toBe(true);
  });

  it('opponent combat + non-land in viewer hand → never auto-pass', () => {
    const s = state({ activePlayer: 'opp', phase: 'DeclareAttackers', hand: [spell()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s }))).toBe(false);
  });

  it('opponent combat + land-only viewer hand → auto-pass', () => {
    const s = state({ activePlayer: 'opp', phase: 'DeclareAttackers', hand: [land()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s }))).toBe(true);
  });

  it('opponent non-combat phase + non-land in hand → auto-pass (no instant window guarded here)', () => {
    const s = state({ activePlayer: 'opp', phase: 'Draw', hand: [spell()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s }))).toBe(true);
  });

  it('Full Control suppresses auto-pass even when every other guard would clear', () => {
    // Construct a state that would normally auto-pass: opponent's draw
    // step, viewer has only lands in hand → guard 6/7 don't fire,
    // guard 5 doesn't fire (no stop). Full Control on → still false.
    const s = state({ activePlayer: 'opp', phase: 'Draw', hand: [land()] });
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s, fullControl: false }))).toBe(true);
    expect(shouldAutoPass(PASS_PROMPT, deps({ state: s, fullControl: true }))).toBe(false);
  });
});
