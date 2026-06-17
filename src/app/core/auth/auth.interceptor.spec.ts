import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpHandlerFn,
  HttpRequest,
  provideHttpClient,
} from '@angular/common/http';
import { BehaviorSubject, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { authInterceptor, shouldAttachAuth } from './auth.interceptor';
import { AuthUserStore } from './auth-user.store';
import { MAJIK_AUTH_CONFIG, MajikAuthConfig } from './auth.config';
import { environment } from '../../../environments/environment';

describe('shouldAttachAuth — URL gating', () => {
  describe('with apiBase set', () => {
    const base = 'https://majik-api.onrender.com';

    it('attaches for URLs starting with apiBase', () => {
      expect(shouldAttachAuth(`${base}/decks`, base)).toBe(true);
      expect(shouldAttachAuth(`${base}/hubs/match`, base)).toBe(true);
    });

    it('does NOT attach for other origins', () => {
      expect(shouldAttachAuth('https://api.scryfall.com/cards', base)).toBe(false);
      expect(shouldAttachAuth('https://evil.example.com/steal', base)).toBe(false);
    });

    it('does NOT attach for same-origin relative paths when apiBase is set', () => {
      expect(shouldAttachAuth('/decks', base)).toBe(false);
    });
  });

  describe('with empty apiBase (same-origin SPA)', () => {
    it('attaches for paths starting with single slash', () => {
      expect(shouldAttachAuth('/api/decks', '')).toBe(true);
      expect(shouldAttachAuth('/hubs/match', '')).toBe(true);
    });

    it('does NOT attach for protocol-relative URLs (token leak guard)', () => {
      // Regression: previously `url.startsWith('/')` accepted '//evil.com/x', which the browser
      // resolves to `https://evil.com/x`. The interceptor would have attached the bearer token
      // to that third-party host.
      expect(shouldAttachAuth('//evil.example.com/steal-token', '')).toBe(false);
      expect(shouldAttachAuth('//attacker', '')).toBe(false);
    });

    it('does NOT attach for absolute http(s) URLs', () => {
      expect(shouldAttachAuth('https://api.scryfall.com/cards/named', '')).toBe(false);
      expect(shouldAttachAuth('http://localhost:5057/decks', '')).toBe(false);
    });
  });
});

const REAL_CFG: MajikAuthConfig = {
  domain: 'majik.us.auth0.com',
  clientId: 'real-client',
  audience: 'https://api.majik.tech',
  redirectUri: 'http://localhost:4200/auth/callback',
};

/** A request that DOES pass the shouldAttachAuth gate (apiBaseUrl origin). */
const API_URL = `${environment.apiBaseUrl}/decks`;

/**
 * Run the interceptor in isolation with a controllable next handler so we can
 * assert whether the request is forwarded. Returns whether `next` was called.
 */
function runInterceptor(): { forwarded: () => boolean; result: ReturnType<HttpInterceptorRun> } {
  let forwarded = false;
  const next: HttpHandlerFn = (r) => {
    forwarded = true;
    return of({} as any);
  };
  const req = new HttpRequest('GET', API_URL);
  const result = TestBed.runInInjectionContext(() => authInterceptor(req, next));
  return { forwarded: () => forwarded, result };
}
type HttpInterceptorRun = (req: HttpRequest<unknown>, next: HttpHandlerFn) => unknown;

describe('authInterceptor — invalid_grant dead-session handling', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function configure(getAccessTokenSilently: () => any): { signOutCalls: () => number } {
    let signOutCalls = 0;
    const fakeStore: Partial<AuthUserStore> = {
      isStub: false,
      signOutDeadSession: () => {
        signOutCalls++;
      },
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: MAJIK_AUTH_CONFIG, useValue: REAL_CFG },
        { provide: AuthUserStore, useValue: fakeStore },
        {
          provide: Auth0Service,
          useValue: {
            isAuthenticated$: new BehaviorSubject<boolean>(true),
            idTokenClaims$: new BehaviorSubject<unknown>(null),
            error$: new Subject<any>(),
            getAccessTokenSilently,
          },
        },
      ],
    });
    return { signOutCalls: () => signOutCalls };
  }

  it('logs out the dead session and does NOT forward the request on invalid_grant', async () => {
    const { signOutCalls } = configure(() => throwError(() => ({ error: 'invalid_grant' })));
    const { forwarded, result } = runInterceptor();
    // EMPTY completes without emitting — the request is cancelled.
    await firstValueFrom(result as any, { defaultValue: 'EMPTY' });
    expect(signOutCalls()).toBe(1);
    expect(forwarded()).toBe(false);
  });

  it('does NOT log out and propagates the error on a transient/network failure', async () => {
    const { signOutCalls } = configure(() => throwError(() => ({ message: 'network', status: 0 })));
    const { forwarded, result } = runInterceptor();
    await expect(firstValueFrom(result as any)).rejects.toMatchObject({ message: 'network' });
    expect(signOutCalls()).toBe(0);
    expect(forwarded()).toBe(false);
  });

  it('forwards the request with a bearer header on success', async () => {
    const { signOutCalls } = configure(() => of('good-jwt'));
    const { forwarded, result } = runInterceptor();
    await firstValueFrom(result as any);
    expect(signOutCalls()).toBe(0);
    expect(forwarded()).toBe(true);
  });
});
