import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { descopeInterceptor } from '@descope/angular-sdk';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

/**
 * Decide whether a given URL should be sent through the Descope interceptor (i.e. is "our" API).
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

  // Stub mode: no Descope SDK in DI, skip interception
  if (auth.isStub) {
    return next(req);
  }

  // Non-API URLs (e.g. Descope CDN, Scryfall): skip
  if (!shouldAttachAuth(req.url, environment.apiBaseUrl)) {
    return next(req);
  }

  // Delegate to Descope's interceptor — pulls token from SDK, refreshes on 401
  return descopeInterceptor(req, next);
};
