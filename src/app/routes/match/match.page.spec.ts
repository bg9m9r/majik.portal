import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchPage, boardInstanceIds } from './match';
import { LayoutPrefsService } from './layout-prefs.service';
import { MatchService } from '../../core/match/match.service';
import { SignalrService, ConnectionState } from '../../core/signalr/signalr.service';
import { GameStore } from '../../core/match/game.store';
import { SelectionService } from '../../core/match/selection.service';
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

  let authExpiredSig: ReturnType<typeof signal<boolean>>;
  let matchSvc: any;
  let signalr: any;
  let game: any;
  // Writable signals exposed so prefs-push effect tests can drive them.
  let fullControlSig: ReturnType<typeof signal<boolean>>;
  let phaseStopsSig: ReturnType<typeof signal<Record<string, 'mine' | 'theirs'>>>;
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
      engineError$: new Subject(),
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
    authExpiredSig = signal(false);
    state$ = new Subject<unknown>();
    fullControlSig = signal<boolean>(false);
    phaseStopsSig = signal<Record<string, 'mine' | 'theirs'>>({});

    matchSvc = {
      current: currentSig.asReadonly(),
      setCurrent: (m: Match | null) => currentSig.set(m),
      get: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      getState: vi.fn(() => Promise.resolve({ ok: true, value: { gameId: 'g-1', youPlayerId: 'p1' } as unknown as GameState })),
      submitCommand: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
      concede: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      submitRoll: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      playDraw: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      updateAutoPassPrefs: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
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
      fullControl: fullControlSig.asReadonly(),
      phaseStops: phaseStopsSig.asReadonly(),
      recentDecisions: signal([]),
      toggleFullControl: vi.fn(),
      togglePhaseStop: vi.fn(),
    };

    router = { navigate: vi.fn(() => Promise.resolve(true)) };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MatchPage,
        SelectionService,
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
            sessionExpired: authExpiredSig.asReadonly(),
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

  // --- onPass clears the local prompt so a second off-priority pass
  //     can't fire before the next server prompt arrives (regression). ---
  it('onPass sends a pass command AND clears the local prompt immediately', async () => {
    const page = init();
    await page.onPass();
    // The pass command was submitted...
    expect(matchSvc.submitCommand).toHaveBeenCalledWith('m-1', { $type: 'pass' });
    // ...and the local prompt was cleared right after, so isMyTurnPrompt()
    // flips false and the Pass button + Space shortcut disable until a new
    // prompt$ message re-arrives. Without this clear the viewer could fire a
    // second pass off-priority.
    expect(game.clearPrompt).toHaveBeenCalledTimes(1);
  });

  // --- "state" channel feeds GameStore (INITIAL join only) ----------

  it('the FIRST "state" channel snapshot seeds GameStore.setState (initial join)', async () => {
    const page = init();
    page.ngOnInit();
    await vi.runOnlyPendingTimersAsync();
    // load() awaited connect + initial get; the server's snapshot-on-join
    // arrives on the "state" channel and seeds the board exactly once.
    state$.next({ gameId: 'g-1', YouPlayerId: 'p9' });
    const lastCall = game.setState.mock.calls.at(-1);
    expect(lastCall?.[0]?.youPlayerId).toBe('p9');
  });

  // --- reconnect resync (PLAN 04: seq-gated, not single-writer) ------
  //
  // JoinMatch is NOT re-invoked on SignalR auto-reconnect (the client's
  // onreconnected handler only resets latches; withAutomaticReconnect()
  // does not replay hub invocations). The server pushes the "state"
  // snapshot only in response to JoinMatch — so on reconnect the snapshot
  // does NOT arrive. The connecting→open /state refetch performs the
  // reconnect resync. PLAN 04 — the page no longer suppresses state$ writes
  // during the reconnect window (the old reconnectResyncOwnsState flag is
  // gone); instead the monotonic seq gate in GameStore.setState drops any
  // snapshot whose seq is older than the current state. So state$ feeds
  // setState unconditionally and ordering safety lives in the store (see
  // game.store.spec — "GameStore seq gate").

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

  it('feeds state$ snapshots to setState unconditionally (seq gate owns ordering — PLAN 04)', async () => {
    const page = init();
    page.ngOnInit();
    await vi.runOnlyPendingTimersAsync();
    currentSig.set(playingMatch());
    TestBed.tick();

    // Initial join snapshot seeds the board once.
    state$.next({ gameId: 'g-1', YouPlayerId: 'p1' });
    const setStateAfterInitial = game.setState.mock.calls.length;
    const getStateBefore = matchSvc.getState.mock.calls.length;

    // Reconnect: connecting → open triggers the /state refetch.
    stateSig.set('connecting');
    TestBed.tick();
    // A buffered snapshot lands on state$ during the reconnect window. PLAN
    // 04 — the page no longer suppresses it; it IS forwarded to setState.
    // Whether it actually mutates the board is decided by the store's seq
    // gate (covered in game.store.spec), not by the page.
    state$.next({ gameId: 'g-1', YouPlayerId: 'LATE' });
    stateSig.set('open');
    TestBed.tick();
    await vi.runOnlyPendingTimersAsync();

    // The /state refetch still runs on reconnect.
    expect(matchSvc.getState.mock.calls.length).toBe(getStateBefore + 1);
    // The state$ push WAS forwarded to setState (no page-level suppression).
    const lateWrites = (game.setState.mock.calls as any[])
      .slice(setStateAfterInitial)
      .filter((c: any[]) => c[0]?.youPlayerId === 'LATE');
    expect(lateWrites.length).toBeGreaterThanOrEqual(1);
  });

  // --- engine-error / terminal-abort wiring -------------------------
  // PR #142 — a backend MatchEngineWatchdog hang/fault aborts the match
  // into the terminal "Errored" state and emits a match.engine-error
  // SignalR event. MatchPage subscribes to engineError$ and refreshes the
  // match so the @switch unmounts the live board (which owns the clock +
  // prompt overlay, the source of the frozen "no active prompt" dead-end)
  // and renders <app-completed-state> on the now-terminal state. This
  // pins the page-level wiring (match.ts load()) that the isolated
  // signalr / completed-state specs don't cover end-to-end.

  it('an engineError$ emission refetches the match (so the terminal state lands)', async () => {
    const page = init();
    page.ngOnInit();
    await vi.runOnlyPendingTimersAsync();
    currentSig.set(playingMatch());
    TestBed.tick();

    // The watchdog-aborted match the refetch will now return.
    matchSvc.get.mockResolvedValue({ ok: true, value: playingMatch({ state: 'Errored' }) });
    const before = matchSvc.get.mock.calls.length;

    signalr.engineError$.next({ matchId: 'm-1', reason: 'engine-hang' });
    await vi.runOnlyPendingTimersAsync();

    // The page refetched and adopted the terminal Errored snapshot, so the
    // template switches off 'Playing' (board unmounts) onto the abort screen.
    expect(matchSvc.get.mock.calls.length).toBeGreaterThan(before);
    expect(currentSig()?.state).toBe('Errored');
  });

  it('engine-error refetch failure surfaces the fetch-error banner instead of failing silently', async () => {
    const page = init();
    page.ngOnInit();
    await vi.runOnlyPendingTimersAsync();
    currentSig.set(playingMatch());
    TestBed.tick();

    matchSvc.get.mockResolvedValue({ ok: false, error: { code: 'network' } });

    signalr.engineError$.next({ matchId: 'm-1', reason: 'engine-fault' });
    await vi.runOnlyPendingTimersAsync();

    expect(page.fetchError()).toBeTruthy();
  });

  // --- session expiry recovery --------------------------------------

  it('SignalR sessionExpired latch toasts and redirects to /login', () => {
    init(); // constructed; the effect is registered
    sessionExpiredSig.set(true);
    TestBed.tick(); // flush effect
    expect(toast.current()?.message).toContain('Session expired');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('AuthUserStore sessionExpired (forceRefresh failure) also toasts + redirects', () => {
    init();
    authExpiredSig.set(true);
    TestBed.tick();
    expect(toast.current()?.message).toContain('Session expired');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('a healthy (recovered) session does NOT redirect to /login', async () => {
    // Both latches start cleared — this is what a recovered session looks
    // like once AuthUserStore clears sessionExpired on re-auth. The page's
    // recovery effect must stay quiet.
    const page = init();
    page.ngOnInit();
    await vi.runOnlyPendingTimersAsync();
    currentSig.set(playingMatch());
    TestBed.tick();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(toast.current()?.message ?? '').not.toContain('Session expired');
  });

  // --- onActivateAbilityRequested wiring ----------------------------

  it('onActivateAbilityRequested sends { $type: activateAbility, permanentInstanceId, abilityId }', async () => {
    const page = init();
    await page.onActivateAbilityRequested({ permanentInstanceId: 'perm-1', abilityId: 'abil-1' });
    expect(matchSvc.submitCommand).toHaveBeenCalledWith(
      'm-1',
      { $type: 'activateAbility', permanentInstanceId: 'perm-1', abilityId: 'abil-1' },
    );
  });

  it('onActivateAbilityRequested toasts on command rejection', async () => {
    const page = init();
    matchSvc.submitCommand.mockResolvedValueOnce({ ok: false, error: { code: 'invalid-request', detail: 'ability not legal' } });
    await page.onActivateAbilityRequested({ permanentInstanceId: 'perm-1', abilityId: 'abil-1' });
    expect(toast.current()?.severity).toBe('error');
    expect(toast.current()?.message).toContain('ability not legal');
  });

  // --- Slice 5a: prefs-push effect tests ----------------------------
  //
  // The prefs-push effect calls updateAutoPassPrefs whenever fullControl
  // or phaseStops changes (with a JSON-sig guard to suppress no-op
  // re-emits). It also pushes once on construction (the initial values).

  it('prefs effect pushes once on construction with the initial prefs', async () => {
    init();
    // The effect runs synchronously on the first signal read in Angular's
    // TestBed; flush the microtask queue so the async pushPrefs resolves.
    await vi.runOnlyPendingTimersAsync();
    // One call on init (initial fullControl=false, phaseStops={}).
    expect(matchSvc.updateAutoPassPrefs).toHaveBeenCalledTimes(1);
    expect(matchSvc.updateAutoPassPrefs).toHaveBeenCalledWith('m-1', {
      fullControl: false,
      phaseStops: {},
    });
  });

  it('prefs effect PUTs with the new prefs when fullControl toggles', async () => {
    init();
    await vi.runOnlyPendingTimersAsync();
    const beforeCount = matchSvc.updateAutoPassPrefs.mock.calls.length;

    // Toggle fullControl — the effect should re-fire with the new value.
    fullControlSig.set(true);
    TestBed.tick(); // flush the effect
    await vi.runOnlyPendingTimersAsync();

    expect(matchSvc.updateAutoPassPrefs.mock.calls.length).toBeGreaterThan(beforeCount);
    const lastArgs = matchSvc.updateAutoPassPrefs.mock.calls.at(-1);
    expect(lastArgs[1].fullControl).toBe(true);
  });

  it('bare Ctrl toggles Full Control; Meta (Win key) and Ctrl+modifier combos do not', () => {
    const page = init();
    const toggle = game.toggleFullControl as ReturnType<typeof vi.fn>;
    const key = (init: KeyboardEventInit) =>
      page.onDocumentKeydown(new KeyboardEvent('keydown', init));

    // Bare Ctrl toggles.
    key({ key: 'Control' });
    expect(toggle).toHaveBeenCalledTimes(1);

    // Meta (Windows/⌘) must NOT toggle — Win+Shift+S screenshot bug.
    key({ key: 'Meta' });
    key({ key: 'Meta', shiftKey: true });
    // Ctrl with a co-modifier (combo, not the bare key) must NOT toggle.
    key({ key: 'Control', shiftKey: true });
    key({ key: 'Control', metaKey: true });
    // OS auto-repeat must NOT re-fire.
    key({ key: 'Control', repeat: true });

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('prefs effect PUTs when phaseStops mutates', async () => {
    init();
    await vi.runOnlyPendingTimersAsync();
    const beforeCount = matchSvc.updateAutoPassPrefs.mock.calls.length;

    // Mutate phaseStops — effect re-fires with updated stops.
    phaseStopsSig.set({ Untap: 'mine' });
    TestBed.tick();
    await vi.runOnlyPendingTimersAsync();

    expect(matchSvc.updateAutoPassPrefs.mock.calls.length).toBeGreaterThan(beforeCount);
    const lastArgs = matchSvc.updateAutoPassPrefs.mock.calls.at(-1);
    expect(lastArgs[1].phaseStops).toEqual({ Untap: 'mine' });
  });

  it('prefs effect does NOT re-PUT when signals re-emit with identical values', async () => {
    init();
    await vi.runOnlyPendingTimersAsync();
    const afterInitCount = matchSvc.updateAutoPassPrefs.mock.calls.length;

    // Re-set to the same values — JSON sig guard must suppress.
    fullControlSig.set(false); // same as initial
    TestBed.tick();
    await vi.runOnlyPendingTimersAsync();

    expect(matchSvc.updateAutoPassPrefs.mock.calls.length).toBe(afterInitCount);
  });
});

// ---------------------------------------------------------------------
// MatchPage — header settings cog (card-size slider dropdown)
//
// The cog lives in the header's right-side row, immediately LEFT of the
// Back link. Clicking it opens a top-right dropdown popover that hosts the
// card-size slider (<app-layout-controls>). The popover's open state is an
// EPHEMERAL local signal (settingsOpen) — it starts closed on every mount,
// is NOT persisted, and closes on cog re-click / Escape / outside-click.
// ---------------------------------------------------------------------
describe('MatchPage — header settings cog dropdown', () => {
  function mountPage() {
    const stateSig = signal<ConnectionState>('idle');
    const currentSig = signal<Match | null>(null);
    const matchSvc = {
      current: currentSig.asReadonly(),
      setCurrent: (m: Match | null) => currentSig.set(m),
      get: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      getState: vi.fn(() => Promise.resolve({ ok: true, value: { gameId: 'g-1', youPlayerId: 'p1' } as unknown as GameState })),
      submitCommand: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
      concede: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      submitRoll: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      playDraw: vi.fn(() => Promise.resolve({ ok: true, value: playingMatch() })),
      updateAutoPassPrefs: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    };
    const signalr = {
      opponentJoined$: new Subject(), stateChanged$: new Subject(), rolled$: new Subject(),
      playerRolled$: new Subject(), playDrawChosen$: new Subject(), clockUpdate$: new Subject(),
      timedOut$: new Subject(), engineError$: new Subject(), botThinking$: new Subject(),
      botDecisions$: new Subject(), event$: new Subject(), prompt$: new Subject(),
      state$: new Subject<unknown>(),
      state: stateSig.asReadonly(),
      reconnectFailed: signal(false).asReadonly(),
      sessionExpired: signal(false).asReadonly(),
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(() => Promise.resolve()),
    };
    const game = {
      setState: vi.fn(), setPrompt: vi.fn(), clearPrompt: vi.fn(), applyEvent: vi.fn(() => true),
      pushBotDecision: vi.fn(), recordStackMutation: vi.fn(), setClockAnchor: vi.fn(), reset: vi.fn(),
      state: signal<GameState | null>(null), prompt: signal(null), selfPlayerIds: signal<string[]>([]),
      isMyTurnPrompt: signal(false), selfTimerState: signal(null), opponentTimerState: signal(null),
      fullControl: signal(false).asReadonly(), phaseStops: signal<Record<string, 'mine' | 'theirs'>>({}).asReadonly(),
      recentDecisions: signal([]), toggleFullControl: vi.fn(), togglePhaseStop: vi.fn(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SelectionService, ToastService,
        { provide: MatchService, useValue: matchSvc },
        { provide: SignalrService, useValue: signalr },
        { provide: GameStore, useValue: game },
        { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)) } },
        { provide: AuthUserStore, useValue: { principal: signal({ sub: 'me' }), handle: signal('Me'), sessionExpired: signal(false).asReadonly() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'm-1' } } } },
      ],
    });
    // Reset shared layout prefs to defaults (slider hidden) BEFORE the first
    // change-detection pass so a flag CI's localStorage file left behind can't
    // leak the cog into the "on" state across tests.
    TestBed.inject(LayoutPrefsService).reset();
    const fixture = TestBed.createComponent(MatchPage);
    fixture.detectChanges();
    return { fixture, prefs: TestBed.inject(LayoutPrefsService) };
  }

  function cogButton(fixture: ReturnType<typeof mountPage>['fixture']): HTMLButtonElement {
    const btn = fixture.nativeElement.querySelector(
      'button[aria-label="Toggle layout settings"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    return btn!;
  }

  // The popover (and its slider) is only in the DOM when open.
  function popover(fixture: ReturnType<typeof mountPage>['fixture']): HTMLElement | null {
    return fixture.nativeElement.querySelector('.settings-popover[role="dialog"]') as HTMLElement | null;
  }
  // The card-size range input lives inside <app-layout-controls> in the popover.
  function slider(fixture: ReturnType<typeof mountPage>['fixture']): HTMLElement | null {
    return fixture.nativeElement.querySelector('.settings-popover app-layout-controls input[type="range"]') as HTMLElement | null;
  }

  it('renders the settings cog button in the header, closed by default', () => {
    const { fixture } = mountPage();
    const btn = cogButton(fixture);
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-haspopup')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.querySelector('svg')).toBeTruthy(); // inline gear icon
    // Closed on mount → no popover, no slider.
    expect(popover(fixture)).toBeNull();
    expect(slider(fixture)).toBeNull();
  });

  it('places the cog immediately BEFORE the Back link in the header row', () => {
    const { fixture } = mountPage();
    const btn = cogButton(fixture);
    const back = fixture.nativeElement.querySelector('a[routerLink="/lobby"]') as HTMLElement;
    expect(back).toBeTruthy();
    // The cog precedes Back in DOM order (the cog now sits in a wrapper, so
    // compare document position rather than a shared parentElement).
    expect(btn.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('clicking the cog OPENS the dropdown with the card-size slider inside it', () => {
    const { fixture } = mountPage();
    const btn = cogButton(fixture);
    expect(slider(fixture)).toBeNull();

    btn.click();
    fixture.detectChanges();

    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(popover(fixture)).not.toBeNull();
    // The slider is now rendered INSIDE the popover, not at the board bottom.
    expect(slider(fixture)).not.toBeNull();
  });

  it('re-clicking the cog toggles the dropdown closed', () => {
    const { fixture } = mountPage();
    const btn = cogButton(fixture);

    btn.click();
    fixture.detectChanges();
    expect(popover(fixture)).not.toBeNull();

    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(popover(fixture)).toBeNull();
  });

  it('Escape closes the open dropdown', () => {
    const { fixture } = mountPage();
    const btn = cogButton(fixture);
    btn.click();
    fixture.detectChanges();
    expect(popover(fixture)).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(popover(fixture)).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('an outside click closes the dropdown; a click inside it does not', () => {
    const { fixture } = mountPage();
    const btn = cogButton(fixture);
    btn.click();
    fixture.detectChanges();
    expect(popover(fixture)).not.toBeNull();

    // A click that lands inside the popover keeps it open.
    popover(fixture)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(popover(fixture)).not.toBeNull();

    // A click elsewhere on the document closes it.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(popover(fixture)).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('the dropdown starts closed on a fresh mount (ephemeral, not persisted)', () => {
    // Open it on one mount...
    const first = mountPage();
    cogButton(first.fixture).click();
    first.fixture.detectChanges();
    expect(popover(first.fixture)).not.toBeNull();

    // ...a brand-new mount starts closed regardless (open state is ephemeral).
    const second = mountPage();
    expect(popover(second.fixture)).toBeNull();
    expect(cogButton(second.fixture).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('boardInstanceIds', () => {
  it('includes player ids', () => {
    const state = { players: [
      { id: 'pA', battlefield: { cards: [{ instanceId: 'c1' }] }, hand: { cards: [] } },
      { id: 'pB', battlefield: { cards: [] }, hand: { cards: [] } },
    ] } as never;
    const ids = boardInstanceIds(state);
    expect(ids.has('pA')).toBe(true);
    expect(ids.has('pB')).toBe(true);
    expect(ids.has('c1')).toBe(true);
  });
});
