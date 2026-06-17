import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { EMPTY, catchError, switchMap, throwError } from 'rxjs';
import { AuthUserStore, isDeadRefreshError } from './auth-user.store';
import { environment } from '../../../environments/environment';

/**
 * Decide whether a given URL should have an Auth0 bearer attached.
 * Pure for testability — exported so security regression tests can pin the rules.
 *
 * Rules:
 *  - If `apiBase` is set, only URLs starting with it count.
 *  - If `apiBase` is empty (same-origin SPA), only same-origin paths (`/foo`) count — and we
 *    reject protocol-relative URLs (`//evil.com/x`) which would otherwise leak the token to a
 *    third-party host.
 */
export function shouldAttachAuth(url: string, apiBase: string): boolean {
  if (apiBase) return url.startsWith(apiBase);
  return url.startsWith('/') && !url.startsWith('//');
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthUserStore);

  // Stub mode: no Auth0 SDK in DI, skip auth header injection
  if (auth.isStub) {
    return next(req);
  }

  // Non-API URLs (e.g. Auth0 tenant, Scryfall): skip
  if (!shouldAttachAuth(req.url, environment.apiBaseUrl)) {
    return next(req);
  }

  const auth0 = inject(Auth0Service, { optional: true });
  if (!auth0) {
    return next(req);
  }

  // Pull a (cached or refreshed) Auth0 access token and attach as bearer.
  // getAccessTokenSilently uses the SDK's internal cache by default and
  // only hits the network when the cached token is near expiry.
  return auth0.getAccessTokenSilently().pipe(
    catchError(err => {
      // A genuinely-dead refresh token (e.g. invalid_grant from refresh-token
      // rotation): log out + purge tokens and cancel the request. A full-page
      // logout redirect is now in flight, so EMPTY (complete-without-emit) is
      // correct — forwarding the request would just 401. Transient/network
      // errors are rethrown unchanged so they propagate to the caller and do
      // NOT trigger a logout.
      if (isDeadRefreshError(err)) {
        auth.signOutDeadSession();
        return EMPTY;
      }
      return throwError(() => err);
    }),
    switchMap(token => next(req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    })))
  );
};
