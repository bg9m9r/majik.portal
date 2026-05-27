import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { BehaviorSubject, NEVER, ReplaySubject, Subject, of, throwError } from 'rxjs';
import { AuthService as Auth0Service, GetTokenSilentlyOptions } from '@auth0/auth0-angular';
import { AUTH_BOOTSTRAP_TIMEOUT_MS, AuthUserStore } from './auth-user.store';
import { MAJIK_AUTH_CONFIG, MajikAuthConfig } from './auth.config';
import { environment } from '../../../environments/environment';

/**
 * Minimal fake of the Auth0 Angular SDK surface that AuthUserStore.bootstrap()
 * subscribes to. We control `isAuthenticated$` + `idTokenClaims$` from the
 * test so we can assert exact race semantics — mirrors the old
 * auth.service.spec fakes verbatim so the consolidation can't quietly
 * regress the bridge.
 */
function makeFakeAuth0(opts: {
  authed$: Subject<boolean>;
  claims$: Subject<unknown>;
  getAccessTokenSilently?: (opts?: GetTokenSilentlyOptions) => any;
}): Partial<Auth0Service> {
  return {
    isAuthenticated$: opts.authed$ as any,
    idTokenClaims$: opts.claims$ as any,
    error$: new Subject<any>() as any,
    getAccessTokenSilently: opts.getAccessTokenSilently as any,
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

function configure(providers: any[]): AuthUserStore {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      ...providers,
    ],
  });
  return TestBed.inject(AuthUserStore);
}

/**
 * `bootstrap()` awaits the Auth0 bridge (a real `firstValueFrom` promise)
 * BEFORE the profile load fires `GET /me`. Flush a few microtask turns so
 * the bridge settles and the request is in flight before we assert on it.
 */
async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('AuthUserStore.bootstrap() — auth bridge', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('resolves immediately in stub mode and populates principal/authed (no Auth0)', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: STUB_CFG },
      { provide: Auth0Service, useValue: null },
    ]);
    const http = TestBed.inject(HttpTestingController);
    const promise = store.bootstrap();
    await tick();
    // Stub auth marks the user authenticated immediately. With apiBaseUrl
    // set in the test env (mongoLikelyConfigured), the authed path fires
    // GET /me — flush it to keep the test deterministic.
    const reqs = http.match(r => r.url.endsWith('/me'));
    reqs.forEach(r => r.flush({ sub: store.principal()!.sub, handle: 'stub', createdAt: 't', updatedAt: 't' }));
    await promise;
    expect(store.isStub).toBe(true);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.ready()).toBe(true);
  });

  it('resolves once Auth0 first emits (logged-in path) and populates principal', async () => {
    const authed$ = new BehaviorSubject<boolean>(false);
    const claims$ = new BehaviorSubject<unknown>(null);
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      { provide: Auth0Service, useValue: makeFakeAuth0({ authed$, claims$ }) },
    ]);
    const http = TestBed.inject(HttpTestingController);
    await store.bootstrap();
    // BehaviorSubject(false) seeded → unauthenticated path skips GET /me.
    expect(store.isAuthenticated()).toBe(false);
    http.expectNone(r => r.url.endsWith('/me'));

    // Flip to authed; long-lived subscriptions update the signals.
    claims$.next({ sub: 'auth0|alice', name: 'Alice' });
    authed$.next(true);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.principal()?.sub).toBe('auth0|alice');
  });

  it('resolves on logged-out emission so app-init does not hang; clears principal', async () => {
    const authed$ = new BehaviorSubject<boolean>(false);
    const claims$ = new BehaviorSubject<unknown>(null);
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      { provide: Auth0Service, useValue: makeFakeAuth0({ authed$, claims$ }) },
    ]);
    await store.bootstrap();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.principal()).toBeNull();
    expect(store.ready()).toBe(true);
  });

  it('sets authed synchronously with isAuthenticated$ even if idTokenClaims$ lags', async () => {
    const authed$ = new ReplaySubject<boolean>(1);
    const claims$ = new Subject<unknown>(); // intentionally NOT emitting
    authed$.next(true);
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      { provide: Auth0Service, useValue: makeFakeAuth0({ authed$, claims$ }) },
    ]);
    const http = TestBed.inject(HttpTestingController);
    const promise = store.bootstrap();
    await tick();
    // authed must be true by the time the bridge settles — even though
    // claims (and therefore principal) have not arrived yet. This is the
    // onboarding-redirect-on-refresh regression guard.
    expect(store.isAuthenticated()).toBe(true);
    // Authenticated → profile bootstrap fires GET /me.
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ sub: 'auth0|x', handle: 'X', createdAt: 't', updatedAt: 't' });
    await promise;
  });

  it('falls back via timeout if Auth0 never emits', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: { isAuthenticated$: NEVER, idTokenClaims$: NEVER, error$: new Subject<any>() },
      },
    ]);
    const start = Date.now();
    await store.bootstrap();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(AUTH_BOOTSTRAP_TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(AUTH_BOOTSTRAP_TIMEOUT_MS + 2000);
    expect(store.isAuthenticated()).toBe(false);
    expect(store.ready()).toBe(true);
  }, AUTH_BOOTSTRAP_TIMEOUT_MS + 5000);
});

describe('AuthUserStore token retrieval', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('getAccessToken() calls Auth0 with default cache (no cacheMode: off)', async () => {
    const observed: GetTokenSilentlyOptions[] = [];
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          getAccessTokenSilently: (opts?: GetTokenSilentlyOptions) => {
            observed.push(opts ?? {});
            return of('cached-jwt');
          },
        },
      },
    ]);
    const token = await store.getAccessToken();
    expect(token).toBe('cached-jwt');
    expect(observed).toHaveLength(1);
    expect(observed[0].cacheMode).toBeUndefined();
  });

  it('forceRefresh() asks Auth0 for a fresh token (cacheMode: off)', async () => {
    const observed: GetTokenSilentlyOptions[] = [];
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          getAccessTokenSilently: (opts?: GetTokenSilentlyOptions) => {
            observed.push(opts ?? {});
            return of('fresh-jwt');
          },
        },
      },
    ]);
    const token = await store.forceRefresh();
    expect(token).toBe('fresh-jwt');
    expect(observed[0].cacheMode).toBe('off');
  });

  it('getAccessToken()/forceRefresh() fall back to the cached signal value on Auth0 error', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          getAccessTokenSilently: () => throwError(() => new Error('boom')),
        },
      },
    ]);
    await expect(store.getAccessToken()).resolves.toBe('');
    await expect(store.forceRefresh()).resolves.toBe('');
  });

  it('forceRefresh() failure latches sessionExpired (refresh token dead → do not silently reuse)', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          getAccessTokenSilently: () => throwError(() => new Error('invalid_grant')),
        },
      },
    ]);
    expect(store.sessionExpired()).toBe(false);
    await store.forceRefresh();
    expect(store.sessionExpired()).toBe(true);
  });

  it('getAccessToken() failure does NOT latch sessionExpired (could be transient)', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          getAccessTokenSilently: () => throwError(() => new Error('blip')),
        },
      },
    ]);
    await store.getAccessToken();
    expect(store.sessionExpired()).toBe(false);
  });

  it('a successful forceRefresh clears a previously-latched sessionExpired', async () => {
    let fail = true;
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          getAccessTokenSilently: () => (fail ? throwError(() => new Error('dead')) : of('fresh-jwt')),
        },
      },
    ]);
    await store.forceRefresh();
    expect(store.sessionExpired()).toBe(true);
    fail = false;
    await store.forceRefresh();
    expect(store.sessionExpired()).toBe(false);
  });

  it('re-authentication (isAuthenticated$ → true) clears a latched sessionExpired', async () => {
    const authed$ = new BehaviorSubject<boolean>(false);
    const claims$ = new BehaviorSubject<unknown>(null);
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: makeFakeAuth0({
          authed$,
          claims$,
          // forceRefresh fails → latches sessionExpired.
          getAccessTokenSilently: () => throwError(() => new Error('dead')),
        }),
      },
    ]);
    const http = TestBed.inject(HttpTestingController);
    // Wire up the isAuthenticated$ subscription via bootstrap().
    await store.bootstrap();
    http.expectNone(r => r.url.endsWith('/me'));

    // A dead forced refresh latches the session-expiry flag.
    await store.forceRefresh();
    expect(store.sessionExpired()).toBe(true);

    // The session recovers (e.g. silent re-auth / new login): the SDK's
    // isAuthenticated$ flips back to true. That MUST clear the latch so a
    // healthy recovered MatchPage isn't bounced to /login.
    authed$.next(true);
    expect(store.sessionExpired()).toBe(false);
    expect(store.isAuthenticated()).toBe(true);
    // Authenticated → profile bootstrap is NOT re-fired by this subscription;
    // no stray GET /me.
    http.expectNone(r => r.url.endsWith('/me'));
  });

  it('isAuthenticated$ → false does NOT spuriously latch sessionExpired', async () => {
    const authed$ = new BehaviorSubject<boolean>(true);
    const claims$ = new BehaviorSubject<unknown>(null);
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: makeFakeAuth0({ authed$, claims$ }),
      },
    ]);
    const http = TestBed.inject(HttpTestingController);
    const promise = store.bootstrap();
    await tick();
    http.match(r => r.url.endsWith('/me')).forEach(r =>
      r.flush({ sub: 'auth0|x', handle: 'X', createdAt: 't', updatedAt: 't' }));
    await promise;
    expect(store.sessionExpired()).toBe(false);
    // Going unauthenticated is not an expiry latch (the latch is reserved
    // for a dead forceRefresh); the flag stays false.
    authed$.next(false);
    expect(store.sessionExpired()).toBe(false);
  });

  it('clearSessionExpired() resets the latch', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          getAccessTokenSilently: () => throwError(() => new Error('dead')),
        },
      },
    ]);
    await store.forceRefresh();
    expect(store.sessionExpired()).toBe(true);
    store.clearSessionExpired();
    expect(store.sessionExpired()).toBe(false);
  });

  it('returns the cached signal in stub mode without invoking Auth0', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: STUB_CFG },
      { provide: Auth0Service, useValue: null },
    ]);
    await expect(store.getAccessToken()).resolves.toBe('');
    await expect(store.forceRefresh()).resolves.toBe('');
  });
});

describe('AuthUserStore.logout()', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('clears authed + principal in stub mode', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: STUB_CFG },
      { provide: Auth0Service, useValue: null },
    ]);
    const http = TestBed.inject(HttpTestingController);
    const promise = store.bootstrap();
    await tick();
    http.match(r => r.url.endsWith('/me')).forEach(r =>
      r.flush({ sub: store.principal()!.sub, handle: 'h', createdAt: 't', updatedAt: 't' }));
    await promise;
    expect(store.isAuthenticated()).toBe(true);
    store.logout();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.principal()).toBeNull();
  });

  it('delegates to Auth0.logout in real mode', async () => {
    let loggedOut = false;
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: {
          isAuthenticated$: new BehaviorSubject<boolean>(true),
          idTokenClaims$: new BehaviorSubject<unknown>(null),
          error$: new Subject<any>(),
          logout: () => {
            loggedOut = true;
            return of(undefined);
          },
        },
      },
    ]);
    store.logout();
    expect(loggedOut).toBe(true);
  });
});

describe('AuthUserStore profile load (GET /me handling)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function authedStore(): { store: AuthUserStore; http: HttpTestingController } {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: makeFakeAuth0({
          authed$: new BehaviorSubject<boolean>(true),
          claims$: new BehaviorSubject<unknown>({ sub: 'auth0|alice', name: 'Alice' }),
        }),
      },
    ]);
    return { store, http: TestBed.inject(HttpTestingController) };
  }

  it('sets profile + ready on 200', async () => {
    const { store, http } = authedStore();
    const promise = store.bootstrap();
    await tick();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ sub: 'auth0|alice', handle: 'Alice', createdAt: 't', updatedAt: 't' });
    await promise;
    expect(store.profile()?.handle).toBe('Alice');
    expect(store.handle()).toBe('Alice');
    expect(store.ready()).toBe(true);
  });

  it('leaves profile null + ready on 404 (onboarding case)', async () => {
    const { store, http } = authedStore();
    const promise = store.bootstrap();
    await tick();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ error: 'no-profile' }, { status: 404, statusText: 'Not Found' });
    await promise;
    expect(store.profile()).toBeNull();
    expect(store.ready()).toBe(true);
  });

  it('synthesizes a profile on 503', async () => {
    const { store, http } = authedStore();
    const promise = store.bootstrap();
    await tick();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ error: 'mongo-not-configured' }, { status: 503, statusText: 'Service Unavailable' });
    await promise;
    expect(store.profile()?.synthetic).toBe(true);
    expect(store.profile()?.handle).toBe('auth0|alice');
    expect(store.ready()).toBe(true);
  });

  it('leaves ready FALSE on 401 so onboardingGuard does not redirect', async () => {
    const { store, http } = authedStore();
    const promise = store.bootstrap();
    await tick();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await promise;
    expect(store.ready()).toBe(false);
    expect(store.profile()).toBeNull();
  });

  it('leaves ready FALSE on status 0 (network / no token)', async () => {
    const { store, http } = authedStore();
    const promise = store.bootstrap();
    await tick();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await promise;
    expect(store.ready()).toBe(false);
    expect(store.profile()).toBeNull();
  });

  it('marks ready + sets null on an unknown server error (e.g. 500)', async () => {
    const { store, http } = authedStore();
    const promise = store.bootstrap();
    await tick();
    const req = http.expectOne(r => r.method === 'GET' && r.url.endsWith('/me'));
    req.flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    await promise;
    expect(store.profile()).toBeNull();
    expect(store.ready()).toBe(true);
  });

  it('skips GET /me + marks ready when unauthenticated', async () => {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: makeFakeAuth0({
          authed$: new BehaviorSubject<boolean>(false),
          claims$: new BehaviorSubject<unknown>(null),
        }),
      },
    ]);
    const http = TestBed.inject(HttpTestingController);
    await store.bootstrap();
    http.expectNone(r => r.url.endsWith('/me'));
    expect(store.ready()).toBe(true);
    expect(store.profile()).toBeNull();
  });
});

describe('AuthUserStore.update(handle)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function authedStore(): { store: AuthUserStore; http: HttpTestingController } {
    const store = configure([
      { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
      {
        provide: Auth0Service,
        useValue: makeFakeAuth0({
          authed$: new BehaviorSubject<boolean>(true),
          claims$: new BehaviorSubject<unknown>({ sub: 'auth0|alice', name: 'Alice' }),
        }),
      },
    ]);
    return { store, http: TestBed.inject(HttpTestingController) };
  }

  it('patches profile + returns ok on 200', async () => {
    const { store, http } = authedStore();
    const promise = store.update('Alice');
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/me'));
    req.flush({ sub: 'auth0|alice', handle: 'Alice', createdAt: 't', updatedAt: 't' });
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(store.profile()?.handle).toBe('Alice');
    expect(store.handle()).toBe('Alice');
  });

  it('returns handle-taken on 409', async () => {
    const { store, http } = authedStore();
    const promise = store.update('Alice');
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/me'));
    req.flush({ error: 'handle-taken' }, { status: 409, statusText: 'Conflict' });
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { code: 'handle-taken' } });
  });

  it('returns invalid-handle on 400', async () => {
    const { store, http } = authedStore();
    const promise = store.update('!!');
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/me'));
    req.flush({ error: 'invalid-handle', detail: 'bad' }, { status: 400, statusText: 'Bad Request' });
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { code: 'invalid-handle', detail: 'bad' } });
  });

  it('returns mongo-not-configured on 503', async () => {
    const { store, http } = authedStore();
    const promise = store.update('Alice');
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/me'));
    req.flush({ error: 'mongo-not-configured' }, { status: 503, statusText: 'Service Unavailable' });
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { code: 'mongo-not-configured' } });
  });

  it('returns network on status 0', async () => {
    const { store, http } = authedStore();
    const promise = store.update('Alice');
    const req = http.expectOne(r => r.method === 'PUT' && r.url.endsWith('/me'));
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    const result = await promise;
    expect(result).toEqual({ ok: false, error: { code: 'network' } });
  });
});
