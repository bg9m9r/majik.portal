import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { BehaviorSubject, NEVER, ReplaySubject, Subject } from 'rxjs';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
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
