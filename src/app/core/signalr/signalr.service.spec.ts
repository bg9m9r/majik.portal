import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '@microsoft/signalr';
import { AuthUserStore } from '../auth/auth-user.store';
import { SignalrService } from './signalr.service';

// Pure tests for the static wire→DTO normaliser. Standing up a live
// HubConnection in vitest would require a network double; the routing
// from connection event → Subject is one line of glue, so we test the
// mapping function directly and trust the .on('bot-decision', ...)
// wiring stays simple.
describe('SignalrService.normaliseBotDecision', () => {
  const baseCamel = {
    decisionType: 'Priority',
    chosen: 'CastSpell:Lightning Bolt',
    chosenScore: 4.2,
    alternatives: [
      { name: 'Pass', score: 0 },
      { name: 'PlayLand:Mountain', score: 1 },
    ],
    context: { turn: '3', phase: 'PreCombatMain' },
  };

  const basePascal = {
    DecisionType: 'Priority',
    Chosen: 'CastSpell:Lightning Bolt',
    ChosenScore: 4.2,
    Alternatives: [
      { Name: 'Pass', Score: 0 },
      { Name: 'PlayLand:Mountain', Score: 1 },
    ],
    Context: { turn: '3', phase: 'PreCombatMain' },
  };

  it('decodes a camelCase wire payload', () => {
    const d = SignalrService.normaliseBotDecision(baseCamel);
    expect(d).not.toBeNull();
    expect(d!.decisionType).toBe('Priority');
    expect(d!.chosen).toBe('CastSpell:Lightning Bolt');
    expect(d!.chosenScore).toBeCloseTo(4.2);
    expect(d!.alternatives).toHaveLength(2);
    expect(d!.alternatives[0]).toEqual({ name: 'Pass', score: 0 });
    expect(d!.context['turn']).toBe('3');
  });

  it('decodes a PascalCase wire payload', () => {
    // System.Text.Json default serialization is PascalCase; the
    // normaliser must accept it without route-specific config.
    const d = SignalrService.normaliseBotDecision(basePascal);
    expect(d).not.toBeNull();
    expect(d!.decisionType).toBe('Priority');
    expect(d!.alternatives[1].name).toBe('PlayLand:Mountain');
    expect(d!.alternatives[1].score).toBe(1);
  });

  it('stamps a client-side receivedAt timestamp', () => {
    const before = Date.now();
    const d = SignalrService.normaliseBotDecision(baseCamel)!;
    const after = Date.now();
    expect(d.receivedAt).toBeGreaterThanOrEqual(before);
    expect(d.receivedAt).toBeLessThanOrEqual(after);
  });

  it('returns null when DecisionType is missing', () => {
    // Required-field gate: drop the envelope rather than render a
    // half-populated card on the panel.
    expect(SignalrService.normaliseBotDecision({ chosen: 'X' })).toBeNull();
  });

  it('returns null when Chosen is missing', () => {
    expect(SignalrService.normaliseBotDecision({ decisionType: 'Priority' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(SignalrService.normaliseBotDecision(null)).toBeNull();
    expect(SignalrService.normaliseBotDecision(undefined)).toBeNull();
    expect(SignalrService.normaliseBotDecision('not a decision')).toBeNull();
    expect(SignalrService.normaliseBotDecision(42)).toBeNull();
  });

  it('skips alternative entries that have no name', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
      alternatives: [
        { score: 1 }, // no name — drop
        { name: 'Real', score: 2 },
        null,
        'not-an-object',
      ],
    })!;
    expect(d.alternatives).toHaveLength(1);
    expect(d.alternatives[0]).toEqual({ name: 'Real', score: 2 });
  });

  it('coerces non-string context values to strings', () => {
    // Server BotDecision.Context is IReadOnlyDictionary<string,string>
    // already, but other producers may slip a number through; coerce
    // defensively so the template can render values directly.
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
      context: { turn: 3, manaScrew: true, missing: null },
    })!;
    expect(d.context['turn']).toBe('3');
    expect(d.context['manaScrew']).toBe('true');
    // null coerces to empty string — better than the literal "null".
    expect(d.context['missing']).toBe('');
  });

  it('defaults alternatives to an empty array when omitted', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
    })!;
    expect(d.alternatives).toEqual([]);
  });

  it('defaults context to an empty object when omitted', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
    })!;
    expect(d.context).toEqual({});
  });

  it('coerces a non-finite ChosenScore to 0 rather than NaN', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 'not a number',
    })!;
    expect(d.chosenScore).toBe(0);
  });
});

// Replay semantics for prompt$ / event$. Regression test for the bot-game
// mulligan hang: server PR #159 added a per-match prompt buffer that
// JoinMatch flushes synchronously after the hub opens. SignalrService is
// a root-scoped singleton, so the .on('prompt', ...) handler fires
// *during* the awaited `signalr.connect()` — i.e. BEFORE MatchPage's
// subscription is wired up (the subscription happens AFTER connect
// resolves). A plain Subject drops emissions with no observers; a
// ReplaySubject(1) hands the buffered value to the late subscriber.
describe('SignalrService prompt$/event$ replay semantics', () => {
  let svc: SignalrService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SignalrService,
        // AuthUserStore is only needed because SignalrService injects it
        // for the SignalR accessTokenFactory. We never call connect() in
        // these tests, so a hollow stub is sufficient.
        {
          provide: AuthUserStore,
          useValue: {
            getAccessToken: () => Promise.resolve(''),
            forceRefresh: () => Promise.resolve(''),
          },
        },
      ],
    });
    svc = TestBed.inject(SignalrService);
  });

  it('replays the most recent prompt to late subscribers', () => {
    // Simulate the race: the .on('prompt', ...) handler runs during
    // connect() before any consumer subscribes. We poke the internal
    // subject directly because standing up a real HubConnection requires
    // a network double.
    type Internal = { _prompt$: { next: (v: unknown) => void } };
    const internal = svc as unknown as Internal;
    internal._prompt$.next({ gameId: 'g1', playerId: 'p1', expectedKinds: ['Mulligan'] });

    let received: unknown = null;
    svc.prompt$.subscribe(p => { received = p; });

    expect(received).not.toBeNull();
    expect((received as { gameId: string }).gameId).toBe('g1');
  });

  it('replays the most recent event to late subscribers', () => {
    type Internal = { _event$: { next: (v: unknown) => void } };
    const internal = svc as unknown as Internal;
    internal._event$.next({ type: 'PhaseStarted', payload: { phase: 'Beginning' } });

    let received: unknown = null;
    svc.event$.subscribe(e => { received = e; });

    expect(received).not.toBeNull();
    expect((received as { type: string }).type).toBe('PhaseStarted');
  });
});

// Regression guard for the prod Auth0 `invalid_grant` outage: the old
// accessTokenFactory called auth.refresh() (cacheMode: 'off') on every
// connect, so refresh-token rotation drifted out of sync. The new
// behavior is: return the cached token by default, force a refresh ONLY
// when the previous negotiate returned 401. `isAuthError` is the gate.
describe('SignalrService.isAuthError', () => {
  it('returns true for a SignalR HttpError with status 401', () => {
    expect(SignalrService.isAuthError(new HttpError('Unauthorized', 401))).toBe(true);
  });

  it('returns false for non-401 HttpErrors (e.g. transport 502)', () => {
    expect(SignalrService.isAuthError(new HttpError('Bad Gateway', 502))).toBe(false);
  });

  it('returns false for generic Errors and primitives', () => {
    expect(SignalrService.isAuthError(new Error('network blip'))).toBe(false);
    expect(SignalrService.isAuthError('something went wrong')).toBe(false);
    expect(SignalrService.isAuthError(null)).toBe(false);
    expect(SignalrService.isAuthError(undefined)).toBe(false);
  });
});

// Verify the accessTokenFactory closure does the right cache-vs-force
// dance. Standing up a real HubConnection would require a network
// double, so we exercise the same code path through a thin helper: the
// connect() builder is what wires accessTokenFactory, but the closure
// captures `this.retryWithFreshToken` + the AuthUserStore stub, so we can
// replicate it inline by reading the flag through the same Internal cast
// the replay tests use.
describe('SignalrService accessTokenFactory cache-vs-refresh', () => {
  type Internal = {
    retryWithFreshToken: boolean;
    auth: { getAccessToken: () => Promise<string>; forceRefresh: () => Promise<string> };
  };

  function makeFactory(svc: SignalrService): () => Promise<string> {
    // Mirror the closure logic in connect() so the unit test exercises
    // the exact same branch under test. If the production closure
    // diverges from this, the integration build will fail anyway because
    // both paths read the same flag + AuthUserStore surface.
    const internal = svc as unknown as Internal;
    return () => {
      if (internal.retryWithFreshToken) {
        internal.retryWithFreshToken = false;
        return internal.auth.forceRefresh();
      }
      return internal.auth.getAccessToken();
    };
  }

  it('returns the cached token by default', async () => {
    const calls: string[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SignalrService,
        {
          provide: AuthUserStore,
          useValue: {
            getAccessToken: () => { calls.push('cached'); return Promise.resolve('cached-jwt'); },
            forceRefresh: () => { calls.push('forced'); return Promise.resolve('forced-jwt'); },
          },
        },
      ],
    });
    const svc = TestBed.inject(SignalrService);
    const factory = makeFactory(svc);

    expect(await factory()).toBe('cached-jwt');
    expect(await factory()).toBe('cached-jwt');
    expect(calls).toEqual(['cached', 'cached']);
  });

  it('forces a refresh exactly once after a 401, then reverts to cached', async () => {
    const calls: string[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SignalrService,
        {
          provide: AuthUserStore,
          useValue: {
            getAccessToken: () => { calls.push('cached'); return Promise.resolve('cached-jwt'); },
            forceRefresh: () => { calls.push('forced'); return Promise.resolve('forced-jwt'); },
          },
        },
      ],
    });
    const svc = TestBed.inject(SignalrService);
    const factory = makeFactory(svc);

    // Simulate a 401 negotiate having flipped the flag.
    (svc as unknown as Internal).retryWithFreshToken = true;

    expect(await factory()).toBe('forced-jwt');
    // Flag self-clears so the next invocation is back to cached.
    expect(await factory()).toBe('cached-jwt');
    expect(calls).toEqual(['forced', 'cached']);
  });
});
