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

/**
 * Auth0 error `error` codes that mean the session / refresh token is
 * genuinely dead — there is no recovering it silently, so the only correct
 * response is to log the user out and send them back to login.
 *
 * Why exactly these four:
 *  - `invalid_grant`         — the refresh token was rejected (rotated away,
 *                              revoked, or expired). This is the prod
 *                              refresh-token-rotation case that bounced users
 *                              to /onboarding.
 *  - `missing_refresh_token` — the SDK has no refresh token to exchange (the
 *                              stored session was cleared / never had one).
 *  - `invalid_refresh_token` — the stored refresh token is malformed / no
 *                              longer accepted by the tenant.
 *  - `login_required`        — Auth0 cannot satisfy a silent auth without an
 *                              interactive login (session gone server-side).
 *
 * All four mean "re-authentication is required". Transient/network errors are
 * deliberately NOT in this set — we must not log the user out on a blip.
 */
const DEAD_REFRESH_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_grant',
  'missing_refresh_token',
  'invalid_refresh_token',
  'login_required',
]);

/**
 * The strict subset of {@link DEAD_REFRESH_ERROR_CODES} that mean a refresh
 * token actually EXISTED and Auth0 REVOKED/REJECTED it. Deliberately excludes
 * `login_required`: a normal logged-out visitor's init-time `checkSession()`
 * emits `login_required` on every page load, so treating it as a trigger for
 * `signOutDeadSession()` → `logout()` → redirect → reload would loop forever.
 * Only these three signal "purge the stored (now-dead) refresh token".
 */
const REVOKED_REFRESH_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_grant',
  'missing_refresh_token',
  'invalid_refresh_token',
]);

/**
 * Extracts the Auth0 error `code` from an `unknown` error, defensive about
 * shape: it may be the raw Auth0 error (`{ error, error_description }`) OR an
 * `HttpErrorResponse` that nests it under `.error.error`. Returns the first
 * string code found (flat preferred), else `undefined`.
 */
function readAuth0ErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as any;
  // Flat Auth0 error: { error: 'invalid_grant', ... }
  if (typeof e.error === 'string') return e.error;
  // Nested (HttpErrorResponse-wrapped): { error: { error: 'invalid_grant' } }
  if (typeof e.error?.error === 'string') return e.error.error;
  return undefined;
}

/**
 * True when `err` is an Auth0 error whose code means a refresh token existed
 * and Auth0 revoked/rejected it (see {@link REVOKED_REFRESH_ERROR_CODES}).
 * Loop-safe: returns FALSE for `login_required` so it is safe to use as an
 * init-time `error$` trigger (a logged-out visitor's `checkSession` emits
 * `login_required` every load). Anything non-revoked returns false.
 */
export function isRevokedRefreshTokenError(err: unknown): boolean {
  const code = readAuth0ErrorCode(err);
  return code !== undefined && REVOKED_REFRESH_ERROR_CODES.has(code);
}

/**
 * True when `err` is an Auth0 error whose code signals a genuinely-dead
 * session/refresh token (see {@link DEAD_REFRESH_ERROR_CODES}). This is the
 * broader set used by the token-required paths (`getAccessToken`/`forceRefresh`
 * and the HTTP interceptor): it additionally includes `login_required`, which
 * on those paths means "Auth0 cannot silently satisfy a token request, the
 * session is gone — re-auth required". Defensive about shape; anything else
 * (network failures, generic `Error`s, null/undefined, non-objects) returns
 * false so transient problems never trigger a logout.
 */
export function isDeadRefreshError(err: unknown): boolean {
  if (isRevokedRefreshTokenError(err)) return true;
  return readAuth0ErrorCode(err) === 'login_required';
}

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
  // Session-expiry latch. Set when a forced token refresh
  // (`getAccessTokenSilently({ cacheMode: 'off' })`) is rejected — i.e.
  // the refresh token is genuinely dead, so silently reusing the stale
  // cached token would just keep 401ing. Consumers (e.g. the match page)
  // surface "session expired" + redirect to login rather than spinning.
  // Cleared by a successful getAccessToken/forceRefresh, by an
  // isAuthenticated$ flip to true (silent re-auth / fresh login recovery),
  // and on logout.
  sessionExpired: boolean;
}

const initial: AuthUserState = {
  principal: null,
  token: null,
  authed: false,
  profile: null,
  ready: false,
  sessionExpired: false,
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

    // Loop-safety latch for signOutDeadSession(): the init-time `error$`
    // subscription can emit a revoked-token error more than once, but
    // Auth0.logout() triggers a full-page redirect — invoking it repeatedly
    // would be wasteful and, combined with the redirect/reload cycle, risks a
    // logout loop. First call sets the flag and proceeds; subsequent calls
    // early-return.
    let signingOut = false;

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
          // On a flip to authed=true, also clear the session-expiry latch.
          // A prior dead forceRefresh latches `sessionExpired`, but nothing
          // in production ever cleared it on recovery: real-mode logout()
          // doesn't, and clearSessionExpired() was never called. A silent
          // re-auth / fresh login that the SDK reports via isAuthenticated$
          // is exactly the recovery signal — clear the latch here so the
          // match page's recovery effect doesn't bounce a healthy,
          // recovered session to /login.
          patchState(store, isAuthed
            ? { authed: true, sessionExpired: false }
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

      // Init-time self-heal for a revoked refresh token. When a returning
      // user's id token is ALSO expired on load, bootstrapProfile skips
      // GET /me (no API call), so no interceptor 403 fires and the dead
      // refresh token would linger until a manual re-login. Auth0's init-time
      // `checkSession()` pushes its failure to `error$`; if that failure is a
      // revoked-token error (NOT `login_required` — that fires for every
      // normal logged-out visitor and would loop), proactively purge the
      // session here. Uses the LOCAL signOutDeadSession (same pattern as the
      // getAccessToken/forceRefresh catch blocks); the latch inside makes
      // repeated emissions a single logout.
      auth0.error$
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe(err => {
          if (isRevokedRefreshTokenError(err)) {
            signOutDeadSession();
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

    /**
     * Log out a session whose refresh token is genuinely dead
     * (`isDeadRefreshError`). Patches a fully logged-out state and, in real
     * mode, calls Auth0 `logout()` which clears the `@@auth0spajs@@` token
     * cache (including refresh tokens) and full-page-redirects to login —
     * satisfying "purge stored refresh tokens". In stub mode there is no SDK
     * and no redirect: we just reset to the logged-out state. This is the
     * single path that replaces the old generic-error fall-through that
     * routed dead sessions to /onboarding.
     */
    function signOutDeadSession(): void {
      // Idempotent: only the first call drives the logout + redirect. Repeated
      // `error$` emissions (or interceptor + error$ racing) must not fire
      // Auth0.logout() more than once.
      if (signingOut) return;
      signingOut = true;
      const loggedOut = {
        authed: false,
        principal: null,
        token: null,
        profile: null,
        ready: true,
        sessionExpired: false,
      } as const;
      if (store.isStub) {
        patchState(store, loggedOut);
        return;
      }
      patchState(store, loggedOut);
      // Same logout call shape as logout(): clears the SDK token cache (incl.
      // refresh tokens) and full-page-redirects back to the app origin.
      auth0?.logout({
        logoutParams: { returnTo: window.location.origin }
      }).subscribe();
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
          if (token) patchState(store, { token, sessionExpired: false });
          return token ?? store.token() ?? '';
        } catch (err) {
          // A dead refresh token here means the session is genuinely gone —
          // log out (and purge stored tokens) rather than silently reusing a
          // stale cached token that will just keep 401ing. Defense-in-depth
          // for the SignalR/default token path (the HTTP interceptor handles
          // the request-time case).
          if (isDeadRefreshError(err)) {
            signOutDeadSession();
            return '';
          }
          // Otherwise: the cached-token path failing is not, on its own, proof
          // the session is dead (could be a transient SDK hiccup). Don't latch
          // sessionExpired here — that's forceRefresh's job. Fall back to
          // whatever cached token we have.
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
          if (fresh) patchState(store, { token: fresh, sessionExpired: false });
          return fresh ?? store.token() ?? '';
        } catch (err) {
          // A dead refresh token → log out + purge tokens rather than just
          // latching sessionExpired. Defense-in-depth for the SignalR retry
          // path that calls forceRefresh after a 401 negotiate.
          if (isDeadRefreshError(err)) {
            signOutDeadSession();
            return '';
          }
          // A forced (cacheMode:'off') refresh failing means Auth0 rejected
          // the refresh token — the session is genuinely dead. Latch
          // sessionExpired so consumers surface "session expired" + redirect
          // to login rather than silently reusing the stale cached token
          // (which would just keep 401ing). Still return the cached value so
          // the immediate caller's contract is unchanged.
          patchState(store, { sessionExpired: true });
          return store.token() ?? '';
        }
      },

      logout(): void {
        if (store.isStub) {
          patchState(store, { authed: false, principal: null, sessionExpired: false });
          return;
        }
        // Clear the expiry latch on an explicit logout too — the full-page
        // Auth0 redirect resets app state regardless, but a deliberate
        // sign-out should never leave the latch hot for the next session.
        patchState(store, { sessionExpired: false });
        auth0?.logout({
          logoutParams: { returnTo: window.location.origin }
        }).subscribe();
      },

      /**
       * Log out a genuinely-dead session (dead refresh token) and purge
       * stored tokens. See the local `signOutDeadSession` for the rationale;
       * exposed so the HTTP interceptor can invoke it on a request-time
       * `invalid_grant`.
       */
      signOutDeadSession(): void {
        signOutDeadSession();
      },

      /** Clear the session-expiry latch (e.g. after re-authenticating). */
      clearSessionExpired(): void {
        patchState(store, { sessionExpired: false });
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
