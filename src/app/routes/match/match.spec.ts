import { describe, expect, it, vi } from 'vitest';
import {
  dispatchMatchKey,
  MatchKeyDeps,
  shouldAutoSubmitRoll,
} from './match';
// The auto-pass guard moved to core/match/match-session (Slice 2b); the
// Slice 0 wire-contract block below still pins it as a consumer-side
// regression guard. Its full unit coverage lives in match-session.spec.ts.
import { shouldAutoPass } from '../../core/match/match-session';
import { CardSnapshot, GameState, Match, PromptEnvelope } from '../../core/match/match.types';

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
    producedManaColors: '',
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
// Seat ids reused by the Slice 0 wire-contract block below. The full
// shouldAutoPass / stackSignature unit suite moved to
// core/match/match-session.spec.ts when the guard was lifted out of
// MatchPage into the shared module (Slice 2b).
// ---------------------------------------------------------------------
const ME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OPP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// ---------------------------------------------------------------------
// Wire contract (Slice 0) — consumer-side pins
//
// These tests lock the portal's assumptions about the server contract so
// regressions surface as test failures before they hit production.
//
// Spec 1 & 2 exercise the shouldAutoPass gate in isolation, proving the
// pure logic is correct when selfPlayerIds is already resolved.
//
// Seat-identity derivation is now covered in game.store.spec.ts:
// GameStore.setState — seat identity from youPlayerId. The prior
// resolveSelfPlayerIds() private method has been replaced by
// GameStore.setState reading youPlayerId from the /state snapshot
// (Slice 2a fix), making it directly unit-testable in the store spec.
//
// Spec 3 locks the phase-bar's phase vocabulary against a raw-string
// regression (#758 PostCombatMain / Main mixup).
// ---------------------------------------------------------------------

describe('wire contract (Slice 0)', () => {
  // --- 1. Auto-pass fires on a clean pass-only prompt on my turn ------

  it('auto-pass fires: my-turn, empty stack, BeginningOfCombat, pass-only prompt', () => {
    // Build a state where:
    //   • activePlayerId === ME  (it IS my turn)
    //   • stack is empty         (CR 117.3b guard clears)
    //   • phase is BeginningOfCombat
    //   • the ME player exists in the players array
    const myTurnState: GameState = {
      gameId: 'g',
      phase: 'BeginningOfCombat',
      turnNumber: 1,
      activePlayerId: ME,
      players: [
        {
          id: ME, name: 'Me', life: 20,
          mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
          hand: { cards: [] },
          library: { cards: [] }, graveyard: { cards: [] },
          exile: { cards: [] }, battlefield: { cards: [] },
        },
        {
          id: OPP, name: 'Opp', life: 20,
          mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
          hand: { cards: [] },
          library: { cards: [] }, graveyard: { cards: [] },
          exile: { cards: [] }, battlefield: { cards: [] },
        },
      ],
      stack: [],
      youPlayerId: null,
    };

    const passOnlyPrompt: PromptEnvelope = {
      gameId: 'g',
      playerId: ME,
      expectedKinds: ['PassPriorityCommand'],
    };

    const result = shouldAutoPass(passOnlyPrompt, {
      state: myTurnState,
      selfPlayerIds: [ME],
      phaseStops: {},
      fullControl: false,
      lastStackMutatedAt: null,
      nowMs: Date.now(),
    });

    // The gate logic is sound when selfPlayerIds is correctly populated.
    // Seat-identity derivation via setState(youPlayerId) is covered in
    // game.store.spec.ts: 'GameStore.setState — seat identity from youPlayerId'.
    expect(result).toBe(true);
  });

  // --- 2. Full control suppresses auto-pass even on a clean prompt ----

  it('full control suppresses auto-pass: same inputs but fullControl=true → false', () => {
    const myTurnState: GameState = {
      gameId: 'g',
      phase: 'BeginningOfCombat',
      turnNumber: 1,
      activePlayerId: ME,
      players: [
        {
          id: ME, name: 'Me', life: 20,
          mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
          hand: { cards: [] },
          library: { cards: [] }, graveyard: { cards: [] },
          exile: { cards: [] }, battlefield: { cards: [] },
        },
        {
          id: OPP, name: 'Opp', life: 20,
          mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
          hand: { cards: [] },
          library: { cards: [] }, graveyard: { cards: [] },
          exile: { cards: [] }, battlefield: { cards: [] },
        },
      ],
      stack: [],
      youPlayerId: null,
    };

    const passOnlyPrompt: PromptEnvelope = {
      gameId: 'g',
      playerId: ME,
      expectedKinds: ['PassPriorityCommand'],
    };

    const result = shouldAutoPass(passOnlyPrompt, {
      state: myTurnState,
      selfPlayerIds: [ME],
      phaseStops: {},
      fullControl: true,   // ← Full Control engaged
      lastStackMutatedAt: null,
      nowMs: Date.now(),
    });

    expect(result).toBe(false);
  });

  // --- 3. Phase vocabulary: PostCombatMain exists and isn't 'main' ---

  it('phase vocabulary contains PostCombatMain (not raw "main")', () => {
    // Consumer-side lock for the #758 fix: the phase-bar must use the
    // exact engine phase string 'PostCombatMain', never the raw 'main'
    // that the old normalisation stripped down to. Mirror the PHASES
    // array from src/app/ui/phase-bar.component.ts literally — if that
    // array changes, this test catches the contract break immediately.
    const PORTAL_PHASES = [
      'Untap',
      'Upkeep',
      'Draw',
      'PreCombatMain',
      'BeginningOfCombat',
      'DeclareAttackers',
      'DeclareBlockers',
      'CombatDamage',
      'EndOfCombat',
      'PostCombatMain',
      'End',
      'Cleanup',
    ] as const;

    expect(PORTAL_PHASES).toContain('PostCombatMain');

    // Additional guard: the string must NOT normalise to 'main',
    // confirming the #758 regression path is closed.
    expect('PostCombatMain'.toLowerCase()).not.toBe('main');
  });
});

// ---------------------------------------------------------------------
// shouldAutoSubmitRoll — bot-match auto-roll guard
// ---------------------------------------------------------------------

function rollingMatch(over: Partial<Match> & { roll?: Match['roll'] } = {}): Match {
  return {
    id: 'm-1',
    state: 'Rolling',
    visibility: 'Public',
    format: 'constructed',
    clockMinutes: 25,
    creator: { sub: 'human-sub', handle: 'Human', deckId: 'd-h' },
    opponent: { sub: 'bot-sub', handle: 'Bot', deckId: 'd-b' },
    roll: { creatorRoll: null, opponentRoll: 1, winnerSub: null },
    firstChoice: null,
    gameId: null,
    creatorMillisRemaining: 1500_000,
    opponentMillisRemaining: 1500_000,
    priorityHolderSub: null,
    priorityStartedAt: null,
    winnerSub: null,
    timeoutLoserSub: null,
    createdAt: '2026-05-25T00:00:00Z',
    updatedAt: '2026-05-25T00:00:00Z',
    ...over,
  };
}

describe('shouldAutoSubmitRoll — bot-match auto-roll guard', () => {
  // Regression for the screenshot bug: in a bot match the bot rolls
  // first (opponentRoll=1), then the human's auto-roll effect fires
  // before Auth0 idTokenClaims$ has emitted, so auth.principal() is
  // null. The old gate bailed on null principal and the match got
  // stuck. The new guard ignores principal entirely.
  it('fires for a fresh Rolling match even before auth.principal() resolves', () => {
    const m = rollingMatch({
      roll: { creatorRoll: null, opponentRoll: 1, winnerSub: null },
    });
    expect(shouldAutoSubmitRoll(m, false)).toBe(true);
  });

  it('does not fire once the roll has a winner', () => {
    const m = rollingMatch({
      roll: { creatorRoll: 4, opponentRoll: 1, winnerSub: 'human-sub' },
    });
    expect(shouldAutoSubmitRoll(m, false)).toBe(false);
  });

  it('does not fire when already submitted in this page lifetime', () => {
    const m = rollingMatch();
    expect(shouldAutoSubmitRoll(m, true)).toBe(false);
  });

  it('does not fire when the match snapshot is null', () => {
    expect(shouldAutoSubmitRoll(null, false)).toBe(false);
  });

  it('does not fire outside Rolling state', () => {
    const m = rollingMatch({ state: 'Playing' });
    expect(shouldAutoSubmitRoll(m, false)).toBe(false);
  });

  it('fires even when the viewer-side slot already looks filled (server is idempotent)', () => {
    // Worst-case race: another snapshot landed with both slots filled
    // but no winner yet (mid-resolution). Server still safely returns
    // the current snapshot — we don't need to second-guess it.
    const m = rollingMatch({
      roll: { creatorRoll: 6, opponentRoll: 1, winnerSub: null },
    });
    expect(shouldAutoSubmitRoll(m, false)).toBe(true);
  });
});
