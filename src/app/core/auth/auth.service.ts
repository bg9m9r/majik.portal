import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DescopeAuthService } from '@descope/angular-sdk';
import { MAJIK_AUTH_CONFIG, isAuthStubbed } from './auth.config';

interface Principal {
  sub: string;
  name?: string;
  discordUserId?: string;
}

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

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly descope = inject(DescopeAuthService, { optional: true });
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
    if (!this.descope) {
      return;
    }
    this.descope.session$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(session => {
        const token = session.sessionToken ?? this.descope?.getSessionToken() ?? null;
        this._token.set(token);
        this._authed.set(session.isAuthenticated);
        if (session.isAuthenticated && session.claims && session.claims['sub']) {
          this._principal.set({
            sub: session.claims['sub'] as string,
            name: session.claims['name'] as string | undefined,
            discordUserId: session.claims['discordUserId'] as string | undefined
          });
        } else if (!session.isAuthenticated) {
          this._principal.set(null);
        }
      });

    // Rehydrate session from stored refresh token (persistent across reloads).
    this.descope.refreshSession(true).subscribe({
      error: () => {
        // No valid refresh token / network error — user will sign in fresh.
      }
    });
  }

  refreshTokenSync(): void {
    if (this.stubMode || !this.descope) return;
    const fresh = this.descope.getSessionToken();
    if (fresh && fresh !== this._token()) {
      this._token.set(fresh);
    }
  }

  /**
   * Force-refresh the Descope session (network round-trip) and return the resulting access token.
   * Used by SignalR's accessTokenFactory so reconnects don't reuse an expired token.
   * Falls back to the cached token on failure.
   */
  async refresh(): Promise<string> {
    if (this.stubMode || !this.descope) {
      return this._token() ?? '';
    }
    try {
      // refreshSession(true) attempts a refresh round-trip using the stored refresh token.
      await new Promise<void>((resolve, reject) => {
        this.descope!.refreshSession(true).subscribe({
          next: () => resolve(),
          error: (err) => reject(err)
        });
      });
    } catch {
      // Refresh failed — fall through and return whatever token we still have cached.
    }
    const fresh = this.descope.getSessionToken();
    if (fresh && fresh !== this._token()) {
      this._token.set(fresh);
    }
    return fresh ?? this._token() ?? '';
  }

  logout(): void {
    if (this.stubMode) {
      this._authed.set(false);
      this._principal.set(null);
      return;
    }
    this.descope?.descopeSdk.logout().subscribe();
  }
}
