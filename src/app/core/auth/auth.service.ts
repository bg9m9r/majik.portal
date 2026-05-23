import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { combineLatest, firstValueFrom } from 'rxjs';
import { MAJIK_AUTH_CONFIG, isAuthStubbed } from './auth.config';

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

  bootstrap(): void {
    if (this.stubMode) {
      const sub = readStubSub();
      this._principal.set({ sub, name: sub });
      this._authed.set(true);
      return;
    }
    if (!this.auth0) {
      return;
    }

    // Auth0 SDK exposes auth state across two streams (isAuthenticated$,
    // idTokenClaims$). Combine so we update signals atomically and don't
    // briefly emit `authed=true` with `principal=null`.
    combineLatest([this.auth0.isAuthenticated$, this.auth0.idTokenClaims$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([authed, claims]) => {
        this._authed.set(authed);
        if (authed && claims) {
          this._principal.set({
            sub: (claims['sub'] as string | undefined) ?? '',
            name: (claims['name'] as string | undefined) ?? (claims['nickname'] as string | undefined),
            discordUserId: claims[NAMESPACED_DISCORD_CLAIM] as string | undefined
          });
        } else if (!authed) {
          this._principal.set(null);
          this._token.set(null);
        }
      });
  }

  /**
   * Force-refresh the access token (network round-trip via Auth0) and
   * cache it. Used by SignalR's accessTokenFactory so reconnects don't
   * reuse an expired JWT. Falls back to the cached token on failure.
   */
  async refresh(): Promise<string> {
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
