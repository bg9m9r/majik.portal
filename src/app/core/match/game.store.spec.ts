import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameStore, GAME_COMMAND_SENDER, GameCommandSender } from './game.store';
import { AuthUserStore } from '../auth/auth-user.store';
import { MatchService } from './match.service';
import { STACK_MUTATION_DISPLAY_MS } from './match-session';
import { BotDecision, CardSnapshot, GameCommand, GameState, Match } from './match.types';

const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// ----------------------------------------------------------------
// Fakes for the store's injected collaborators. These let the store
// be exercised without standing up Auth0 / HttpClient / SignalR — the
// store reads only the viewer `sub` (AuthUserStore.principal), the live
// MatchDto (MatchService.current), and a command sender.
// ----------------------------------------------------------------
class FakeAuth {
  readonly _principal = signal<{ sub: string } | null>(null);
  readonly principal = this._principal.asReadonly();
  setSub(sub: string | null): void {
    this._principal.set(sub ? { sub } : null);
  }
}

class FakeMatch {
  readonly _current = signal<Match | null>(null);
  readonly current = this._current.asReadonly();
  setCurrent(m: Match | null): void {
    this._current.set(m);
  }
}

class FakeSender implements GameCommandSender {
  readonly sent: GameCommand[] = [];
  send(cmd: GameCommand): void {
    this.sent.push(cmd);
  }
}

// Default fake providers so the store's injected collaborators resolve
// without standing up Auth0 / HttpClient. The existing describe blocks
// that only need the plain store reuse this via `storeProviders()`.
function storeProviders() {
  return [
    { provide: AuthUserStore, useValue: new FakeAuth() },
    { provide: MatchService, useValue: new FakeMatch() },
    { provide: GAME_COMMAND_SENDER, useValue: new FakeSender() },
  ];
}

function configureStore(): {
  store: InstanceType<typeof GameStore>;
  auth: FakeAuth;
  match: FakeMatch;
  sender: FakeSender;
} {
  const auth = new FakeAuth();
  const match = new FakeMatch();
  const sender = new FakeSender();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthUserStore, useValue: auth },
      { provide: MatchService, useValue: match },
      { provide: GAME_COMMAND_SENDER, useValue: sender },
    ],
  });
  const store = TestBed.inject(GameStore);
  store.reset();
  return { store, auth, match, sender };
}

function matchDto(over: Partial<Match> = {}): Match {
  return {
    id: 'm-1',
    state: 'Playing',
    visibility: 'Public',
    format: 'constructed',
    clockMinutes: 25,
    creator: { sub: ALICE, handle: 'Alice', deckId: 'd-a' },
    opponent: { sub: BOB, handle: 'Bob', deckId: 'd-b' },
    roll: null,
    firstChoice: null,
    gameId: 'g-1',
    creatorMillisRemaining: 1_500_000,
    opponentMillisRemaining: 1_500_000,
    priorityHolderSub: null,
    priorityStartedAt: null,
    winnerSub: null,
    timeoutLoserSub: null,
    createdAt: '2026-05-25T00:00:00Z',
    updatedAt: '2026-05-25T00:00:00Z',
    ...over,
  };
}

function passOnlyPrompt(over: Partial<import('./match.types').PromptEnvelope> = {}) {
  return {
    gameId: 'g-1',
    playerId: ALICE,
    expectedKinds: ['PassPriorityCommand'],
    ...over,
  };
}

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
    seq: 0,
  };
}

// ----------------------------------------------------------------
// GameStore.setState — seat-identity derivation from youPlayerId
// ----------------------------------------------------------------
describe('GameStore.setState — seat identity from youPlayerId', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: storeProviders() });
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
    TestBed.configureTestingModule({ providers: storeProviders() });
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

// ----------------------------------------------------------------
// PLAN 04 — monotonic seq gates on setState + applyEvent.
// ----------------------------------------------------------------
describe('GameStore seq gate (PLAN 04)', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: storeProviders() });
    store = TestBed.inject(GameStore);
    store.reset();
  });

  it('setState drops a stale snapshot whose seq is older than current', () => {
    store.setState({ ...snapshot(), seq: 5, turnNumber: 5 });
    const v0 = store.stateVersion();
    // An older snapshot (lost a race) must be dropped.
    store.setState({ ...snapshot(), seq: 3, turnNumber: 3 });
    expect(store.state()!.seq).toBe(5);
    expect(store.state()!.turnNumber).toBe(5);
    expect(store.stateVersion()).toBe(v0); // no write happened
  });

  it('setState accepts a newer snapshot', () => {
    store.setState({ ...snapshot(), seq: 5, turnNumber: 5 });
    store.setState({ ...snapshot(), seq: 6, turnNumber: 6 });
    expect(store.state()!.seq).toBe(6);
    expect(store.state()!.turnNumber).toBe(6);
  });

  it('setState always accepts when either seq is 0 (pre-deploy degradation)', () => {
    store.setState({ ...snapshot(), seq: 0, turnNumber: 9 });
    // Older "turn" but seq 0 → gate disengaged, snapshot accepted.
    store.setState({ ...snapshot(), seq: 0, turnNumber: 2 });
    expect(store.state()!.turnNumber).toBe(2);
  });

  it('applyEvent applies the next contiguous event (seq == current+1) and advances seq', () => {
    store.setState({ ...snapshot(), seq: 10 });
    const ok = store.applyEvent({
      type: 'LifeChangedEvent', seq: 11,
      payload: { playerId: BOB, previous: 20, current: 18 },
    });
    expect(ok).toBe(true);
    expect(store.state()!.players.find(p => p.id === BOB)!.life).toBe(18);
    expect(store.state()!.seq).toBe(11);
  });

  it('applyEvent is a success no-op for a duplicate / stale event (seq <= current)', () => {
    store.setState({ ...snapshot(), seq: 10 });
    const v0 = store.stateVersion();
    // Duplicate (seq == current): returns true (no refetch) but does NOT
    // re-apply the delta.
    const ok = store.applyEvent({
      type: 'LifeChangedEvent', seq: 10,
      payload: { playerId: BOB, previous: 20, current: 1 },
    });
    expect(ok).toBe(true);
    expect(store.state()!.players.find(p => p.id === BOB)!.life).toBe(20); // unchanged
    expect(store.stateVersion()).toBe(v0); // no state write
  });

  it('applyEvent returns false (→ refetch) on a gap (seq > current+1)', () => {
    store.setState({ ...snapshot(), seq: 10 });
    const v0 = store.stateVersion();
    const ok = store.applyEvent({
      type: 'LifeChangedEvent', seq: 13,
      payload: { playerId: BOB, previous: 20, current: 18 },
    });
    expect(ok).toBe(false); // gap → caller refetches /state
    expect(store.stateVersion()).toBe(v0); // nothing applied
  });

  it('applyEvent ignores the gate when seqs are absent (0) — legacy apply path', () => {
    store.setState(snapshot()); // seq 0
    const ok = store.applyEvent({
      type: 'LifeChangedEvent', // no seq → 0
      payload: { playerId: BOB, previous: 20, current: 17 },
    });
    expect(ok).toBe(true);
    expect(store.state()!.players.find(p => p.id === BOB)!.life).toBe(17);
  });
});

// Tests focused on the bot-decision ring buffer behaviour — independent
// from the engine-event reducer above. The ring is appended via
// pushBotDecision (newest first) and capped at MAX_RECENT_DECISIONS=10.
describe('GameStore.recentDecisions', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: storeProviders() });
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
    TestBed.configureTestingModule({ providers: storeProviders() });
    store = TestBed.inject(GameStore);
    store.reset();
  });

  it('defaults to the standard MTG-client opponent-turn stops (BoC + End)', () => {
    // Mirrors AutoPassPrefs.Default on the server: hold priority only at
    // beginning-of-combat + end step on the opponent's turn; auto-pass
    // everywhere else (own-turn dead windows handled by the server's
    // empty-action gate).
    expect(store.phaseStops()).toEqual({
      BeginningOfCombat: 'theirs',
      End: 'theirs',
    });
  });

  it('cycles a phase chip null → mine → theirs → null', () => {
    // Use a phase that is NOT one of the defaults so the assertions
    // don't depend on the default-stops shape.
    store.togglePhaseStop('Untap');
    expect(store.phaseStops()['Untap']).toBe('mine');

    store.togglePhaseStop('Untap');
    expect(store.phaseStops()['Untap']).toBe('theirs');

    store.togglePhaseStop('Untap');
    expect(store.phaseStops()['Untap']).toBeUndefined();
  });

  it('tracks each phase independently', () => {
    store.clearPhaseStops();
    store.togglePhaseStop('Untap');         // mine
    store.togglePhaseStop('PreCombatMain'); // mine
    store.togglePhaseStop('PreCombatMain'); // theirs

    expect(store.phaseStops()).toEqual({
      Untap: 'mine',
      PreCombatMain: 'theirs',
    });
  });

  it('clearPhaseStops wipes all entries (including the defaults)', () => {
    store.togglePhaseStop('Untap');
    store.togglePhaseStop('Draw');
    store.clearPhaseStops();
    expect(store.phaseStops()).toEqual({});
  });

  it('reset restores the default opponent-turn stops', () => {
    store.clearPhaseStops();
    store.togglePhaseStop('Untap');
    store.reset();
    expect(store.phaseStops()).toEqual({
      BeginningOfCombat: 'theirs',
      End: 'theirs',
    });
  });
});

describe('GameStore.landsPlayedThisTurn — CR 305.2 land-drop tracker (client-derived)', () => {
  let store: InstanceType<typeof GameStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: storeProviders() });
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

// ----------------------------------------------------------------
// Card factories for the auto-pass / timer specs (mirror match.spec.ts).
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Task 4 — fullControl / clockAnchor / recordStackMutation
// ----------------------------------------------------------------
describe('GameStore — Task 4 session state + methods', () => {
  it('fullControl starts false and toggleFullControl flips it', () => {
    const { store } = configureStore();
    expect(store.fullControl()).toBe(false);
    store.toggleFullControl();
    expect(store.fullControl()).toBe(true);
    store.toggleFullControl();
    expect(store.fullControl()).toBe(false);
  });

  it('reset clears fullControl', () => {
    const { store } = configureStore();
    store.toggleFullControl();
    store.reset();
    expect(store.fullControl()).toBe(false);
  });

  it('clockAnchor starts null', () => {
    const { store } = configureStore();
    expect(store.clockAnchor()).toBeNull();
  });

  it('setClockAnchor records ms / holder / a timestamp from a Match', () => {
    const { store } = configureStore();
    const m = matchDto({
      creatorMillisRemaining: 900_000,
      opponentMillisRemaining: 800_000,
      priorityHolderSub: ALICE,
    });
    store.setClockAnchor(m);
    const a = store.clockAnchor()!;
    expect(a.creatorMs).toBe(900_000);
    expect(a.opponentMs).toBe(800_000);
    expect(a.holderSub).toBe(ALICE);
    expect(typeof a.at).toBe('number');
  });

  it('setClockAnchor(null) clears the anchor', () => {
    const { store } = configureStore();
    store.setClockAnchor(matchDto());
    store.setClockAnchor(null);
    expect(store.clockAnchor()).toBeNull();
  });

  it('recordStackMutation stamps lastStackMutatedAt only when the signature changes', () => {
    const { store } = configureStore();
    expect(store.lastStackMutatedAt()).toBeNull();

    const withItem: GameState = {
      ...snapshot(),
      stack: [{ id: 's1', kind: 'Spell', description: 'Bolt' }],
    };
    store.recordStackMutation(withItem);
    const first = store.lastStackMutatedAt();
    expect(first).not.toBeNull();
    expect(store.lastStackSig()).toBe('1|s1');

    // Same stack again → no new stamp.
    const beforeSecond = store.lastStackMutatedAt();
    store.recordStackMutation({
      ...snapshot(),
      stack: [{ id: 's1', kind: 'Spell', description: 'Bolt' }],
    });
    expect(store.lastStackMutatedAt()).toBe(beforeSecond);

    // Different stack → new stamp.
    store.recordStackMutation({
      ...snapshot(),
      stack: [{ id: 's2', kind: 'Spell', description: 'Other' }],
    });
    expect(store.lastStackSig()).toBe('1|s2');
  });

  it('lastStackSig defaults to "0|" and reset restores it', () => {
    const { store } = configureStore();
    expect(store.lastStackSig()).toBe('0|');
    store.recordStackMutation({
      ...snapshot(),
      stack: [{ id: 's1', kind: 'Spell', description: 'Bolt' }],
    });
    expect(store.lastStackSig()).toBe('1|s1');
    store.reset();
    expect(store.lastStackSig()).toBe('0|');
    expect(store.lastStackMutatedAt()).toBeNull();
  });
});

// ----------------------------------------------------------------
// Task 5 — clock derivation (selfTimerState / opponentTimerState)
// ----------------------------------------------------------------
describe('GameStore — Task 5 clock derivation', () => {
  it('returns null when match / anchor / viewer sub are missing', () => {
    const { store } = configureStore();
    expect(store.selfTimerState()).toBeNull();
    expect(store.opponentTimerState()).toBeNull();
  });

  it('formats self / opponent clocks from the anchor (viewer = creator)', () => {
    const { store, auth, match } = configureStore();
    auth.setSub(ALICE);
    const m = matchDto({
      creatorMillisRemaining: 605_000, // 10:05
      opponentMillisRemaining: 120_000, // 02:00
      priorityHolderSub: null,
    });
    match.setCurrent(m);
    store.setClockAnchor(m);
    store.setTick(Date.now());

    const self = store.selfTimerState()!;
    const opp = store.opponentTimerState()!;
    expect(self.text).toBe('10:05');
    expect(opp.text).toBe('02:00');
    expect(self.active).toBe(false);
    expect(opp.active).toBe(false);
  });

  it('viewer = opponent maps self → opponentMs', () => {
    const { store, auth, match } = configureStore();
    auth.setSub(BOB);
    const m = matchDto({
      creatorMillisRemaining: 605_000,
      opponentMillisRemaining: 120_000,
    });
    match.setCurrent(m);
    store.setClockAnchor(m);
    expect(store.selfTimerState()!.text).toBe('02:00');
    expect(store.opponentTimerState()!.text).toBe('10:05');
  });

  it('burns local time off the priority holder and flips active', () => {
    const { store, auth, match } = configureStore();
    auth.setSub(ALICE);
    const anchorAt = 1_000_000;
    const m = matchDto({
      creatorMillisRemaining: 600_000,
      opponentMillisRemaining: 600_000,
      priorityHolderSub: ALICE,
    });
    match.setCurrent(m);
    // Stamp the anchor at a deterministic time, then advance the tick.
    store.setClockAnchorAt(m, anchorAt);
    store.setTick(anchorAt + 5_000); // 5s elapsed

    const self = store.selfTimerState()!;
    const opp = store.opponentTimerState()!;
    expect(self.active).toBe(true);
    expect(self.text).toBe('09:55'); // 600s - 5s
    // Opponent doesn't hold priority — no burn.
    expect(opp.active).toBe(false);
    expect(opp.text).toBe('10:00');
  });

  it('flags low (<=30s) on the burning clock', () => {
    const { store, auth, match } = configureStore();
    auth.setSub(ALICE);
    const at = 2_000_000;
    const m = matchDto({
      creatorMillisRemaining: 31_000,
      opponentMillisRemaining: 600_000,
      priorityHolderSub: ALICE,
    });
    match.setCurrent(m);
    store.setClockAnchorAt(m, at);
    store.setTick(at + 2_000); // → 29s remaining
    const self = store.selfTimerState()!;
    expect(self.low).toBe(true);
    expect(self.text).toBe('00:29');
  });
});

// ----------------------------------------------------------------
// Slice 5a — shouldAutoPassNow (server-contract reference computed)
//
// The client-side auto-pass DRIVER (runAutoPass + heartbeat interval)
// has been removed. The server now owns the auto-pass loop. The pure
// shouldAutoPass() function and the shouldAutoPassNow computed are
// retained here as the wire-contract reference — they document the
// logic the server implements and are exercised in full by
// match-session.spec.ts. These store-level tests verify that the
// computed wires through game-store state correctly.
// ----------------------------------------------------------------
describe('GameStore — shouldAutoPassNow (contract reference)', () => {
  function playingState(over: Partial<GameState> & { hand?: CardSnapshot[] } = {}): GameState {
    const { hand = [], ...rest } = over;
    return {
      ...snapshot(),
      phase: 'BeginningOfCombat',
      activePlayerId: ALICE,
      players: [
        {
          id: ALICE, name: 'Alice', life: 20,
          mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
          hand: { cards: hand }, library: { cards: [] }, graveyard: { cards: [] },
          exile: { cards: [] }, battlefield: { cards: [] },
        },
        {
          id: BOB, name: 'Bob', life: 20,
          mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
          hand: { cards: [] }, library: { cards: [] }, graveyard: { cards: [] },
          exile: { cards: [] }, battlefield: { cards: [] },
        },
      ],
      youPlayerId: ALICE,
      ...rest,
    };
  }

  function armCleanPassPrompt(store: InstanceType<typeof GameStore>): void {
    store.setState(playingState());
    store.setPrompt(passOnlyPrompt());
  }

  it('shouldAutoPassNow is true for a clean my-turn pass-only prompt', () => {
    const { store } = configureStore();
    armCleanPassPrompt(store);
    expect(store.shouldAutoPassNow()).toBe(true);
  });

  it('shouldAutoPassNow is false when fullControl is on', () => {
    const { store } = configureStore();
    armCleanPassPrompt(store);
    store.toggleFullControl();
    expect(store.shouldAutoPassNow()).toBe(false);
  });

  it('shouldAutoPassNow is false with a phase stop on the active side', () => {
    const { store } = configureStore();
    store.setState(playingState({ phase: 'Untap' }));
    store.setPrompt(passOnlyPrompt());
    store.togglePhaseStop('Untap'); // → mine
    expect(store.shouldAutoPassNow()).toBe(false);
  });

  it('shouldAutoPassNow is false with a non-empty stack', () => {
    const { store } = configureStore();
    store.setState(playingState({ stack: [{ id: 's1', kind: 'Spell', description: 'x' }] }));
    store.setPrompt(passOnlyPrompt());
    expect(store.shouldAutoPassNow()).toBe(false);
  });

  it('shouldAutoPassNow is false within the stack-mutation display window', () => {
    const { store } = configureStore();
    armCleanPassPrompt(store);
    store.recordStackMutation({
      ...playingState(),
      stack: [{ id: 's1', kind: 'Spell', description: 'x' }],
    });
    // Tick set to just after the mutation but inside the window. The
    // guard reads autoPassTick for nowMs.
    const at = store.lastStackMutatedAt()!;
    store.setAutoPassTick(at + (STACK_MUTATION_DISPLAY_MS - 100));
    expect(store.shouldAutoPassNow()).toBe(false);
    // After the window expires the guard clears (stack back to empty via
    // a fresh state snapshot).
    store.setState(playingState());
    store.setAutoPassTick(at + STACK_MUTATION_DISPLAY_MS + 10);
    expect(store.shouldAutoPassNow()).toBe(true);
  });

  it('shouldAutoPassNow is false with empty selfPlayerIds', () => {
    const { store } = configureStore();
    store.setState({ ...playingState(), youPlayerId: null });
    store.setSelfPlayerIds([]);
    store.setPrompt(passOnlyPrompt());
    expect(store.shouldAutoPassNow()).toBe(false);
  });
});
