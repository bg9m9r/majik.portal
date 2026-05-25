import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { filter, firstValueFrom, race, take, timer } from 'rxjs';
import { MAJIK_AUTH_CONFIG, isAuthStubbed } from './auth.config';

/**
 * Upper bound for how long app-init will wait on Auth0's first
 * `isAuthenticated$` emission. The SDK normally resolves within a tick
 * (cached session) or after the redirect callback completes; falling
 * back after this window means a misconfigured tenant cannot brick the
 * whole app — we just treat the user as logged out and route to /login.
 */
export const AUTH_BOOTSTRAP_TIMEOUT_MS = 5000;

interface Principal {
  sub: string;
  name?: string;
  discordUserId?: string;
}

const NAMESPACED_DISCORD_CLAIM = 'https://majik.tech/discord_user_id';

function readStubSub(): string {
  if (typeof window === 'undefined') return 'stub-dev-user';
  try {
    const params = new URL(window.location.href).searchParams;
    const name = params.get('stub');
    if (name) {
      window.sessionStorage.setItem('majik.stubSub', `stub-${name}`);
      return `stub-${name}`;
    }
    return window.sessionStorage.getItem('majik.stubSub') ?? 'stub-dev-user';
  } catch {
    return 'stub-dev-user';
  }
}

/**
 * Thin façade over the Auth0 SPA SDK that exposes a signal-based API the
 * rest of the app codes against, and preserves stub-mode (`?stub=` URL
 * override in dev) for tests + offline development.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth0 = inject(Auth0Service, { optional: true });
  private readonly cfg = inject(MAJIK_AUTH_CONFIG);
  private readonly destroyRef = inject(DestroyRef);

  private readonly stubMode = isAuthStubbed(this.cfg);
  private readonly _token = signal<string | null>(null);
  private readonly _principal = signal<Principal | null>(null);
  private readonly _authed = signal<boolean>(false);

  readonly token = this._token.asReadonly();
  readonly principal = this._principal.asReadonly();
  readonly isAuthenticated = computed(() => this._authed());
  readonly isStub = this.stubMode;

  /**
   * Subscribes to Auth0 auth-state streams and resolves once Auth0 has
   * settled its initial state (either `authenticated=true` after a
   * redirect-callback exchange, or `authenticated=false` for a logged-out
   * visitor). Callers (e.g. the app initializer that drives ProfileService)
   * MUST await this before firing authenticated requests — otherwise a
   * mid-callback `GET /me` races the token exchange and 401s, which used
   * to bounce every returning user to /onboarding.
   *
   * Resolves on the first emission rather than waiting for a `true` so
   * logged-out users don't hang at app-init; they fall through to the
   * route guard, which sends them to /login.
   */
  async bootstrap(): Promise<void> {
    if (this.stubMode) {
      const sub = readStubSub();
      this._principal.set({ sub, name: sub });
      this._authed.set(true);
      return;
    }
    if (!this.auth0) {
      return;
    }

    // Drive `_authed` directly from `isAuthenticated$` — the SDK gates
    // that stream on its own `isLoading$` so by the time it fires we
    // know auth0 has settled. We subscribe BEFORE the await below so
    // that when the stream emits, the subscribe callback runs (setting
    // the signal) before the firstValueFrom promise resolves and hands
    // control back to the app initializer. Previously we used
    // combineLatest([isAuthenticated$, idTokenClaims$]) and awaited
    // isAuthenticated$ alone — `idTokenClaims$` lags by one async hop
    // (concatMap → getIdTokenClaims), so combineLatest hadn't fired
    // by the time the await resolved, leaving `_authed` stuck at
    // false and bouncing every refresh to /onboarding.
    this.auth0.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(authed => {
        this._authed.set(authed);
        if (!authed) {
          this._principal.set(null);
          this._token.set(null);
        }
      });

    // Principal is populated from idTokenClaims$ once the SDK resolves
    // them. This subscription is independent of the one above so a
    // claim-fetch delay can't gate `_authed` (and therefore can't
    // block ProfileService.bootstrap from firing GET /me).
    this.auth0.idTokenClaims$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(claims => {
        if (claims) {
          this._principal.set({
            sub: (claims['sub'] as string | undefined) ?? '',
            name: (claims['name'] as string | undefined) ?? (claims['nickname'] as string | undefined),
            discordUserId: claims[NAMESPACED_DISCORD_CLAIM] as string | undefined
          });
        }
      });

    // Wait for the first definite auth-state emission, with a timeout
    // fallback so a misbehaving SDK can't deadlock app-init.
    await firstValueFrom(
      race(
        this.auth0.isAuthenticated$.pipe(
          filter((v): v is boolean => typeof v === 'boolean'),
          take(1)
        ),
        timer(AUTH_BOOTSTRAP_TIMEOUT_MS)
      )
    );
  }

  /**
   * Return the current Auth0 access token using the SDK's default cache
   * behavior — the SDK transparently refreshes only when the cached token
   * is near expiry. This is what `SignalrService`'s `accessTokenFactory`
   * uses by default; forcing a refresh on every connect is what triggered
   * the prod Auth0 `invalid_grant` regression with refresh-token rotation
   * enabled (rotated refresh tokens drift out of sync when reused
   * aggressively across rapid reconnects).
   */
  async getAccessToken(): Promise<string> {
    if (this.stubMode || !this.auth0) {
      return this._token() ?? '';
    }
    try {
      const token = await firstValueFrom(this.auth0.getAccessTokenSilently());
      if (token) this._token.set(token);
      return token ?? this._token() ?? '';
    } catch {
      return this._token() ?? '';
    }
  }

  /**
   * Force a network-level refresh of the access token (cacheMode: 'off').
   * Reserved for explicit retry paths — e.g. SignalR's accessTokenFactory
   * after a 401 negotiate. Do NOT use as the default token getter; see
   * `getAccessToken()` for the steady-state path.
   */
  async forceRefresh(): Promise<string> {
    if (this.stubMode || !this.auth0) {
      return this._token() ?? '';
    }
    try {
      const fresh = await firstValueFrom(
        this.auth0.getAccessTokenSilently({ cacheMode: 'off' })
      );
      if (fresh) this._token.set(fresh);
      return fresh ?? this._token() ?? '';
    } catch {
      return this._token() ?? '';
    }
  }

  logout(): void {
    if (this.stubMode) {
      this._authed.set(false);
      this._principal.set(null);
      return;
    }
    this.auth0?.logout({
      logoutParams: { returnTo: window.location.origin }
    }).subscribe();
  }
}
