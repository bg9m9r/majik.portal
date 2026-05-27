import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchPage } from './match';
import { MatchService } from '../../core/match/match.service';
import { SignalrService, ConnectionState } from '../../core/signalr/signalr.service';
import { GameStore } from '../../core/match/game.store';
import { AuthUserStore } from '../../core/auth/auth-user.store';
import { ToastService } from '../../ui/toast.service';
import { GameState, Match } from '../../core/match/match.types';

// ---------------------------------------------------------------------
// Component-level wiring for the Slice 4c resilience behaviours:
//   * refresh()/fetchState() failure → fetchError signal + toast
//   * onManualRefresh() re-fetches and clears the error on success
//   * submitCommand failure (via onConcede) → toast
//   * a reconnect (connecting → open, mid-Playing) → /state re-fetch
//   * the "state" SignalR channel feeds GameStore.setState
//   * a 401 / sessionExpired latch → toast + redirect to /login
//
// We stub the DI graph so MatchPage can be constructed without the live
// HTTP / SignalR / Auth0 machinery, mirroring the project's store-test
// stubbing pattern.
// ---------------------------------------------------------------------

function playingMatch(over: Partial<Match> = {}): Match {
  return {
    id: 'm-1',
    state: 'Playing',
    visibility: 'Public',
    format: 'constructed',
    clockMinutes: 25,
    creator: { sub: 'me', handle: 'Me', deckId: 'd1' },
    opponent: { sub: 'opp', handle: 'Opp', deckId: 'd2' },
    roll: { creatorRoll: 6, opponentRoll: 1, winnerSub: 'me' },
    firstChoice: 'play',
    gameId: 'g-1',
    creatorMillisRemaining: 1500000,
    opponentMillisRemaining: 1500000,
    priorityHolderSub: null,
    priorityStartedAt: null,
    winnerSub: null,
    timeoutLoserSub: null,
    createdAt: '2026-05-25T00:00:00Z',
    updatedAt: '2026-05-25T00:00:00Z',
    ...over,
  };
}

describe('MatchPage — resilience wiring', () => {
  let currentSig: ReturnType<typeof signal<Match | null>>;
  let stateSig: ReturnType<typeof signal<ConnectionState>>;
  let reconnectFailedSig: ReturnType<typeof signal<boolean>>;
  let sessionExpiredSig: ReturnType<typeof signal<boolean>>;
  let state$: Subject<unknown>;

  let matchSvc: any;
  let signalr: any;
  let game: any;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let toast: ToastService;

  function makeSignalrStreams() {
    return {
      opponentJoined$: new Subject(),
      stateChanged$: new Subject(),
      rolled$: new Subject(),
      playerRolled$: new Subject(),
      playDrawChosen$: new Subject(),
      clockUpdate$: new Subject(),
      timedOut$: new Subject(),
      botThinking$: new Subject(),
      botDecisions$: new Subject(),
      event$: new Subject(),
      prompt$: new Subject(),
      state$,
    };
  }

  function init(): MatchPage {
    currentSig = signal<Match | null>(null);
    stateSig = signal<ConnectionState>('idle');
    reconnectFailedSig = signal(false);
    sessionExpiredSig = signal(false);
    state$ = new Subject<unknown>();

    matchSvc = {
      current: currentSig.asReadonly(),
      setCurrent: (m: Match | null) => currentSig.set(m),
      get: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      getState: vi.fn(() => Promise.resolve({ ok: true, value: { gameId: 'g-1', youPlayerId: 'p1' } as unknown as GameState })),
      submitCommand: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
      concede: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      submitRoll: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      playDraw: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
    };

    signalr = {
      ...makeSignalrStreams(),
      state: stateSig.asReadonly(),
      reconnectFailed: reconnectFailedSig.asReadonly(),
      sessionExpired: sessionExpiredSig.asReadonly(),
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(() => Promise.resolve()),
    };

    game = {
      setState: vi.fn(),
      setPrompt: vi.fn(),
      clearPrompt: vi.fn(),
      applyEvent: vi.fn(() => true),
      pushBotDecision: vi.fn(),
      recordStackMutation: vi.fn(),
      setClockAnchor: vi.fn(),
      reset: vi.fn(),
      // Signals read by the template / effects — provide stub readers.
      state: signal<GameState | null>(null),
      prompt: signal(null),
      selfPlayerIds: signal<string[]>([]),
      isMyTurnPrompt: signal(false),
      selfTimerState: signal(null),
      opponentTimerState: signal(null),
      fullControl: signal(false),
      phaseStops: signal({}),
      recentDecisions: signal([]),
      toggleFullControl: vi.fn(),
      togglePhaseStop: vi.fn(),
    };

    router = { navigate: vi.fn(() => Promise.resolve(true)) };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MatchPage,
        ToastService,
        { provide: MatchService, useValue: matchSvc },
        { provide: SignalrService, useValue: signalr },
        { provide: GameStore, useValue: game },
        { provide: Router, useValue: router },
        {
          provide: AuthUserStore,
          useValue: {
            principal: signal({ sub: 'me' }),
            handle: signal('Me'),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'm-1' } } },
        },
      ],
    });
    toast = TestBed.inject(ToastService);
    return TestBed.inject(MatchPage);
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- refresh() / fetchState() failure surfacing -------------------

  it('fetchState failure sets fetchError + toasts; success clears it', async () => {
    const page = init();
    matchSvc.getState
      .mockResolvedValueOnce({ ok: false, error: { code: 'unknown' } })
      .mockResolvedValueOnce({ ok: true, value: { gameId: 'g-1', youPlayerId: 'p1' } });

    await (page as any).fetchState();
    expect(page.fetchError()).not.toBeNull();
    expect(toast.current()?.severity).toBe('error');

    // A retry that succeeds clears the error.
    await (page as any).fetchState();
    expect(page.fetchError()).toBeNull();
  });

  it('refresh failure sets fetchError; onManualRefresh re-fetches', async () => {
    const page = init();
    matchSvc.get.mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
    await (page as any).refresh();
    expect(page.fetchError()).toContain('Connection problem');

    // Manual refresh: get succeeds (default), state Playing → getState called.
    currentSig.set(playingMatch());
    matchSvc.get.mockResolvedValue({ ok: true, value: playingMatch() });
    const getStateCallsBefore = matchSvc.getState.mock.calls.length;
    await page.onManualRefresh();
    expect(page.fetchError()).toBeNull();
    expect(matchSvc.getState.mock.calls.length).toBeGreaterThan(getStateCallsBefore);
  });

  // --- command-reject feedback --------------------------------------

  it('onConcede failure toasts the rejection', async () => {
    const page = init();
    matchSvc.concede.mockResolvedValueOnce({ ok: false, error: { code: 'cannot-concede' } });
    await page.onConcede();
    expect(toast.current()?.severity).toBe('error');
    expect(toast.current()?.message).toContain('concede');
  });

  // --- "state" channel feeds GameStore ------------------------------

  it('a "state" channel snapshot updates GameStore.setState', async () => {
    const page = init();
    page.ngOnInit();
    await vi.runOnlyPendingTimersAsync();
    // load() awaited connect + initial get; now push a snapshot on the
    // "state" channel and assert it reaches the store.
    state$.next({ gameId: 'g-1', YouPlayerId: 'p9' });
    const lastCall = game.setState.mock.calls.at(-1);
    expect(lastCall?.[0]?.youPlayerId).toBe('p9');
  });

  // --- reconnect resync ---------------------------------------------

  it('a connecting→open transition while Playing re-fetches /state', async () => {
    const page = init();
    page.ngOnInit();
    await vi.runOnlyPendingTimersAsync();
    currentSig.set(playingMatch());
    TestBed.tick(); // flush effects

    const before = matchSvc.getState.mock.calls.length;
    // Simulate a reconnect.
    stateSig.set('connecting');
    TestBed.tick();
    stateSig.set('open');
    TestBed.tick();
    await vi.runOnlyPendingTimersAsync();

    expect(matchSvc.getState.mock.calls.length).toBeGreaterThan(before);
  });

  // --- session expiry recovery --------------------------------------

  it('sessionExpired latch toasts and redirects to /login', () => {
    const page = init();
    void page; // constructed; the effect is registered
    sessionExpiredSig.set(true);
    TestBed.tick(); // flush effect
    expect(toast.current()?.message).toContain('Session expired');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
