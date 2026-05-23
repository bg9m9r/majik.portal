import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { switchMap } from 'rxjs';
import { AuthService } from './auth.service';
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
  const auth = inject(AuthService);

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
    switchMap(token => next(req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    })))
  );
};
