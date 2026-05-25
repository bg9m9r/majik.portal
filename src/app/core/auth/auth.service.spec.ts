import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { BehaviorSubject, NEVER, ReplaySubject, Subject, of, throwError } from 'rxjs';
import { AuthService as Auth0Service, GetTokenSilentlyOptions } from '@auth0/auth0-angular';
import { AUTH_BOOTSTRAP_TIMEOUT_MS, AuthService } from './auth.service';
import { MAJIK_AUTH_CONFIG, MajikAuthConfig } from './auth.config';

/**
 * Minimal fake of the Auth0 Angular SDK surface that AuthService.bootstrap()
 * subscribes to. We control `isAuthenticated$` + `idTokenClaims$` from the
 * test so we can assert exact race semantics.
 */
function makeFakeAuth0(opts: {
  authed$: Subject<boolean>;
  claims$: Subject<unknown>;
}): Partial<Auth0Service> {
  return {
    isAuthenticated$: opts.authed$ as any,
    idTokenClaims$: opts.claims$ as any,
    error$: new Subject<any>() as any,
  };
}

const REAL_CFG: MajikAuthConfig = {
  domain: 'majik.us.auth0.com',
  clientId: 'real-client',
  audience: 'https://api.majik.tech',
  redirectUri: 'http://localhost:4200/auth/callback',
};

const STUB_CFG: MajikAuthConfig = {
  domain: '',
  clientId: '',
  audience: '',
  redirectUri: '',
};

describe('AuthService.bootstrap()', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('resolves immediately in stub mode (no Auth0 SDK needed)', async () => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: STUB_CFG },
        { provide: Auth0Service, useValue: null },
      ],
    });
    const svc = TestBed.inject(AuthService);
    await svc.bootstrap();
    expect(svc.isStub).toBe(true);
    expect(svc.isAuthenticated()).toBe(true);
  });

  it('resolves once Auth0 first emits authenticated=true (logged-in path)', async () => {
    const authed$ = new BehaviorSubject<boolean>(false);
    const claims$ = new BehaviorSubject<unknown>(null);
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        { provide: Auth0Service, useValue: makeFakeAuth0({ authed$, claims$ }) },
      ],
    });
    const svc = TestBed.inject(AuthService);
    // BehaviorSubject(false) already has a value — bootstrap should resolve
    // on the first emission (false) without hanging. This is exactly the
    // logged-out path we need to NOT deadlock app-init.
    await svc.bootstrap();
    expect(svc.isAuthenticated()).toBe(false);

    // Now flip to authed; signals update via the long-lived subscription.
    claims$.next({ sub: 'auth0|alice', name: 'Alice' });
    authed$.next(true);
    expect(svc.isAuthenticated()).toBe(true);
    expect(svc.principal()?.sub).toBe('auth0|alice');
  });

  it('resolves on logged-out emission so app-init does not hang', async () => {
    const authed$ = new BehaviorSubject<boolean>(false);
    const claims$ = new BehaviorSubject<unknown>(null);
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        { provide: Auth0Service, useValue: makeFakeAuth0({ authed$, claims$ }) },
      ],
    });
    const svc = TestBed.inject(AuthService);
    // Should resolve from the BehaviorSubject's seeded `false` value.
    await svc.bootstrap();
    expect(svc.isAuthenticated()).toBe(false);
    expect(svc.principal()).toBeNull();
  });

  it('sets _authed synchronously with the isAuthenticated$ emission even if idTokenClaims$ lags', async () => {
    // Regression for the onboarding-redirect-on-refresh bug: the SDK's
    // real-world emission order is `isAuthenticated$` first, then
    // `idTokenClaims$` one concatMap hop later. Previously the
    // signal-updating subscription was on combineLatest of both, so the
    // await on isAuthenticated$ would resolve before the signal was
    // touched, leaving `auth.isAuthenticated()` returning `false` to
    // ProfileService.bootstrap. We model that ordering here with a
    // ReplaySubject for authed that emits true synchronously on the
    // SDK settle, and a claims$ that does NOT emit yet.
    const authed$ = new ReplaySubject<boolean>(1);
    const claims$ = new Subject<unknown>(); // intentionally NOT emitting
    authed$.next(true);
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        { provide: Auth0Service, useValue: makeFakeAuth0({ authed$, claims$ }) },
      ],
    });
    const svc = TestBed.inject(AuthService);
    await svc.bootstrap();
    // Critical assertion: by the time bootstrap resolves, the auth
    // signal MUST reflect the latest isAuthenticated$ value — even
    // though claims have not arrived yet.
    expect(svc.isAuthenticated()).toBe(true);
  });

  it('falls back via timeout if Auth0 never emits', async () => {
    // Stream that never fires — simulates a misconfigured tenant. Without
    // the timeout guard, app-init would hang forever.
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        {
          provide: Auth0Service,
          useValue: {
            isAuthenticated$: NEVER,
            idTokenClaims$: NEVER,
            error$: new Subject<any>(),
          },
        },
      ],
    });
    const svc = TestBed.inject(AuthService);
    const start = Date.now();
    await svc.bootstrap();
    const elapsed = Date.now() - start;
    // Should resolve via the timer race within (timeout + jitter).
    expect(elapsed).toBeGreaterThanOrEqual(AUTH_BOOTSTRAP_TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(AUTH_BOOTSTRAP_TIMEOUT_MS + 2000);
    expect(svc.isAuthenticated()).toBe(false);
  }, AUTH_BOOTSTRAP_TIMEOUT_MS + 5000);
});

/**
 * Regression coverage for the prod Auth0 `invalid_grant` outage on
 * `POST auth.majik.tech/oauth/token`. The previous SignalR
 * accessTokenFactory always called a force-refresh path; with refresh
 * token rotation enabled at Auth0, the rotated refresh token drifted
 * out of sync across rapid reconnects and the next refresh blew up.
 *
 * The new contract is split:
 *  - `getAccessToken()` uses the Auth0 SDK cache (default) — what
 *    SignalR's accessTokenFactory + the HTTP interceptor both use in
 *    the happy path.
 *  - `forceRefresh()` is reserved for the explicit retry-after-401
 *    path. Keep the two distinct so a future caller can't accidentally
 *    regress to the aggressive behavior.
 */
describe('AuthService token retrieval', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('getAccessToken() calls Auth0 with default cache (no cacheMode: off)', async () => {
    const observed: GetTokenSilentlyOptions[] = [];
    const fakeAuth0 = {
      isAuthenticated$: new BehaviorSubject<boolean>(true),
      idTokenClaims$: new BehaviorSubject<unknown>(null),
      error$: new Subject<any>(),
      getAccessTokenSilently: (opts?: GetTokenSilentlyOptions) => {
        observed.push(opts ?? {});
        return of('cached-jwt');
      },
    };
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        { provide: Auth0Service, useValue: fakeAuth0 },
      ],
    });
    const svc = TestBed.inject(AuthService);

    const token = await svc.getAccessToken();
    expect(token).toBe('cached-jwt');
    expect(observed).toHaveLength(1);
    // Default cache mode — the SDK refreshes only when near expiry.
    // The previous bug was passing `{ cacheMode: 'off' }` here, which
    // bypassed the cache and hammered Auth0's token endpoint.
    expect(observed[0].cacheMode).toBeUndefined();
  });

  it('forceRefresh() asks Auth0 for a fresh token (cacheMode: off)', async () => {
    const observed: GetTokenSilentlyOptions[] = [];
    const fakeAuth0 = {
      isAuthenticated$: new BehaviorSubject<boolean>(true),
      idTokenClaims$: new BehaviorSubject<unknown>(null),
      error$: new Subject<any>(),
      getAccessTokenSilently: (opts?: GetTokenSilentlyOptions) => {
        observed.push(opts ?? {});
        return of('fresh-jwt');
      },
    };
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        { provide: Auth0Service, useValue: fakeAuth0 },
      ],
    });
    const svc = TestBed.inject(AuthService);

    const token = await svc.forceRefresh();
    expect(token).toBe('fresh-jwt');
    expect(observed[0].cacheMode).toBe('off');
  });

  it('getAccessToken() falls back to the cached signal value on Auth0 error', async () => {
    // If Auth0 throws (e.g. network drop, transient tenant issue) the
    // factory must not propagate — SignalR would refuse to connect.
    // Returning the previously-cached token lets reconnect attempts
    // continue; the server enforces token validity at negotiate time.
    const fakeAuth0 = {
      isAuthenticated$: new BehaviorSubject<boolean>(true),
      idTokenClaims$: new BehaviorSubject<unknown>(null),
      error$: new Subject<any>(),
      getAccessTokenSilently: () => throwError(() => new Error('boom')),
    };
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        { provide: Auth0Service, useValue: fakeAuth0 },
      ],
    });
    const svc = TestBed.inject(AuthService);

    // No prior token cached — should resolve to ''.
    await expect(svc.getAccessToken()).resolves.toBe('');
    await expect(svc.forceRefresh()).resolves.toBe('');
  });

  it('returns the cached signal in stub mode without invoking Auth0', async () => {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: MAJIK_AUTH_CONFIG, useValue: STUB_CFG },
        { provide: Auth0Service, useValue: null },
      ],
    });
    const svc = TestBed.inject(AuthService);
    // In stub mode there's no Auth0 SDK, so both paths short-circuit
    // to the cached signal — exercise both for symmetry.
    await expect(svc.getAccessToken()).resolves.toBe('');
    await expect(svc.forceRefresh()).resolves.toBe('');
  });
});
