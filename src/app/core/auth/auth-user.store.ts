import { DestroyRef, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signalStore, withComputed, withMethods, withProps, withState, patchState } from '@ngrx/signals';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { filter, firstValueFrom, race, take, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { MAJIK_AUTH_CONFIG, isAuthStubbed } from './auth.config';
import { Profile, ProfileError } from '../profile/profile.types';

/**
 * Upper bound for how long app-init will wait on Auth0's first
 * `isAuthenticated$` emission. The SDK normally resolves within a tick
 * (cached session) or after the redirect callback completes; falling
 * back after this window means a misconfigured tenant cannot brick the
 * whole app — we just treat the user as logged out and route to /login.
 */
export const AUTH_BOOTSTRAP_TIMEOUT_MS = 5000;

export interface Principal {
  sub: string;
  name?: string;
  discordUserId?: string;
}

const NAMESPACED_DISCORD_CLAIM = 'https://majik.tech/discord_user_id';

interface ProfileDtoWire {
  sub: string;
  handle: string;
  createdAt: string;
  updatedAt: string;
}

interface ProfileErrorWire {
  error: string;
  detail?: string;
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

function mongoLikelyConfigured(): boolean {
  // Heuristic for stub mode only: assume Mongo is configured when
  // apiBaseUrl is set (real backend); otherwise synthesize.
  return !!environment.apiBaseUrl;
}

interface AuthUserState {
  principal: Principal | null;
  token: string | null;
  authed: boolean;
  profile: Profile | null;
  ready: boolean;
}

const initial: AuthUserState = {
  principal: null,
  token: null,
  authed: false,
  profile: null,
  ready: false,
};

/**
 * Single source of truth for user identity — consolidates the former
 * `AuthService` (Auth0/Descope session bridge: principal / token / authed)
 * and `ProfileService` (`GET /me` profile load: profile / ready) into one
 * `@ngrx/signals` store. This is the auth critical path; the bridge +
 * profile-load logic below is ported verbatim from those two services and
 * the public accessor names are preserved so consumers change only their
 * injection target.
 */
export const AuthUserStore = signalStore(
  { providedIn: 'root' },
  withState<AuthUserState>(initial),
  // Stub-mode flag is a plain boolean (consumers read `store.isStub`,
  // not `store.isStub()`). It's derived once at construction from the
  // injected auth config, exactly like the former AuthService.isStub.
  withProps(() => {
    const cfg = inject(MAJIK_AUTH_CONFIG);
    return { isStub: isAuthStubbed(cfg) };
  }),
  withComputed(({ authed, ready, profile }) => ({
    // Preserve the former AuthService.isAuthenticated / ProfileService
    // .isReady / .handle accessor names so consumers change only their
    // injection target, not their call sites.
    isAuthenticated: computed(() => authed()),
    isReady: computed(() => ready()),
    handle: computed(() => profile()?.handle ?? null),
  })),
  withMethods((store) => {
    const auth0 = inject(Auth0Service, { optional: true });
    const http = inject(HttpClient);
    const destroyRef = inject(DestroyRef);

    /**
     * Subscribes to Auth0 auth-state streams and resolves once Auth0 has
     * settled its initial state (either `authenticated=true` after a
     * redirect-callback exchange, or `authenticated=false` for a
     * logged-out visitor). MUST resolve before the profile load fires
     * `GET /me` — otherwise a mid-callback request races the token
     * exchange and 401s, bouncing every returning user to /onboarding.
     *
     * Resolves on the first emission rather than waiting for a `true` so
     * logged-out users don't hang at app-init; they fall through to the
     * route guard, which sends them to /login.
     */
    async function bootstrapAuth(): Promise<void> {
      if (store.isStub) {
        const sub = readStubSub();
        patchState(store, { principal: { sub, name: sub }, authed: true });
        return;
      }
      if (!auth0) {
        return;
      }

      // Drive `authed` directly from `isAuthenticated$` — the SDK gates
      // that stream on its own `isLoading$` so by the time it fires we
      // know auth0 has settled. We subscribe BEFORE the await below so
      // that when the stream emits, the subscribe callback runs (setting
      // the signal) before the firstValueFrom promise resolves and hands
      // control back to the app initializer. Previously combineLatest of
      // isAuthenticated$ + idTokenClaims$ lagged by one async hop and
      // left `authed` stuck at false, bouncing every refresh to
      // /onboarding.
      auth0.isAuthenticated$
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe(isAuthed => {
          patchState(store, isAuthed
            ? { authed: true }
            : { authed: false, principal: null, token: null });
        });

      // Principal is populated from idTokenClaims$ once the SDK resolves
      // them. Independent of the subscription above so a claim-fetch
      // delay can't gate `authed` (and therefore can't block the profile
      // load from firing GET /me).
      auth0.idTokenClaims$
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe(claims => {
          if (claims) {
            patchState(store, {
              principal: {
                sub: (claims['sub'] as string | undefined) ?? '',
                name: (claims['name'] as string | undefined) ?? (claims['nickname'] as string | undefined),
                discordUserId: claims[NAMESPACED_DISCORD_CLAIM] as string | undefined,
              },
            });
          }
        });

      // Wait for the first definite auth-state emission, with a timeout
      // fallback so a misbehaving SDK can't deadlock app-init.
      await firstValueFrom(
        race(
          auth0.isAuthenticated$.pipe(
            filter((v): v is boolean => typeof v === 'boolean'),
            take(1)
          ),
          timer(AUTH_BOOTSTRAP_TIMEOUT_MS)
        )
      );
    }

    /** Client-side fallback for 503/stub-without-mongo: derive a profile
     *  from the auth sub so the rest of the UI works. */
    function synthesize(): void {
      const sub = store.principal()?.sub ?? 'unknown';
      const now = new Date().toISOString();
      patchState(store, {
        profile: {
          sub,
          handle: sub,
          createdAt: now,
          updatedAt: now,
          synthetic: true,
        },
      });
    }

    async function bootstrapProfile(): Promise<void> {
      if (store.isStub && !mongoLikelyConfigured()) {
        // Stub auth + Mongo expected absent: synthesize immediately, no GET.
        synthesize();
        patchState(store, { ready: true });
        return;
      }
      // Skip the `GET /me` entirely when the user isn't authenticated. The
      // auth guard will redirect to /login; firing the request would 401
      // anyway and (pre-fix) cause the onboarding guard to redirect to
      // /onboarding instead.
      if (!store.isAuthenticated()) {
        patchState(store, { ready: true });
        return;
      }
      try {
        const dto = await firstValueFrom(
          http.get<ProfileDtoWire>(`${environment.apiBaseUrl}/me`));
        patchState(store, { profile: { ...dto }, ready: true });
      } catch (err) {
        const e = err as HttpErrorResponse;
        if (e.status === 404) {
          // Authenticated but no row yet — legitimate onboarding case.
          patchState(store, { profile: null, ready: true });
        } else if (e.status === 503) {
          synthesize();
          patchState(store, { ready: true });
        } else if (e.status === 401 || e.status === 0) {
          // Auth not ready (token exchange still in flight) or transport
          // failure. DO NOT mark ready — leaving `ready=false` keeps the
          // onboarding guard from sending an already-onboarded user to
          // /onboarding on a transient error. The auth guard / route
          // navigation will surface the real state once auth settles.
          patchState(store, { profile: null });
        } else {
          // Unknown server error — surface as "no profile, ready" so the
          // user isn't stuck on a blank screen; they'll land on
          // /onboarding and any subsequent save will retry against the
          // live API.
          patchState(store, { profile: null, ready: true });
        }
      }
    }

    return {
      /**
       * Single app-init entry point: settle the Auth0/Descope session
       * first, THEN load the profile. Order matters at await time —
       * profile's `GET /me` must not race the redirect-callback token
       * exchange. Replaces the former two-step
       * `await auth.bootstrap(); await profile.bootstrap();`.
       */
      async bootstrap(): Promise<void> {
        await bootstrapAuth();
        await bootstrapProfile();
      },

      /**
       * Return the current Auth0 access token using the SDK's default
       * cache behavior — the SDK transparently refreshes only when the
       * cached token is near expiry. This is what SignalR's
       * accessTokenFactory uses by default; forcing a refresh on every
       * connect is what triggered the prod Auth0 `invalid_grant`
       * regression with refresh-token rotation enabled.
       */
      async getAccessToken(): Promise<string> {
        if (store.isStub || !auth0) {
          return store.token() ?? '';
        }
        try {
          const token = await firstValueFrom(auth0.getAccessTokenSilently());
          if (token) patchState(store, { token });
          return token ?? store.token() ?? '';
        } catch {
          return store.token() ?? '';
        }
      },

      /**
       * Force a network-level refresh of the access token
       * (cacheMode: 'off'). Reserved for explicit retry paths — e.g.
       * SignalR's accessTokenFactory after a 401 negotiate. Do NOT use as
       * the default token getter; see `getAccessToken()` for the
       * steady-state path.
       */
      async forceRefresh(): Promise<string> {
        if (store.isStub || !auth0) {
          return store.token() ?? '';
        }
        try {
          const fresh = await firstValueFrom(
            auth0.getAccessTokenSilently({ cacheMode: 'off' })
          );
          if (fresh) patchState(store, { token: fresh });
          return fresh ?? store.token() ?? '';
        } catch {
          return store.token() ?? '';
        }
      },

      logout(): void {
        if (store.isStub) {
          patchState(store, { authed: false, principal: null });
          return;
        }
        auth0?.logout({
          logoutParams: { returnTo: window.location.origin }
        }).subscribe();
      },

      async update(handle: string): Promise<{ ok: true; profile: Profile } | { ok: false; error: ProfileError }> {
        try {
          const dto = await firstValueFrom(
            http.put<ProfileDtoWire>(`${environment.apiBaseUrl}/me`, { handle }));
          const profile: Profile = { ...dto };
          patchState(store, { profile });
          return { ok: true, profile };
        } catch (err) {
          const e = err as HttpErrorResponse;
          const body = e.error as ProfileErrorWire | undefined;
          const code = body?.error;
          if (e.status === 400 && code === 'invalid-handle') {
            return { ok: false, error: { code: 'invalid-handle', detail: body?.detail } };
          }
          if (e.status === 409 && code === 'handle-taken') {
            return { ok: false, error: { code: 'handle-taken' } };
          }
          if (e.status === 503) {
            return { ok: false, error: { code: 'mongo-not-configured' } };
          }
          if (e.status === 0) {
            return { ok: false, error: { code: 'network' } };
          }
          return { ok: false, error: { code: 'unknown', detail: e.message } };
        }
      },
    };
  })
);

export type AuthUserStore = InstanceType<typeof AuthUserStore>;
