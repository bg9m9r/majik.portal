import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { descopeInterceptor } from '@descope/angular-sdk';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  // Stub mode: no Descope SDK in DI, skip interception
  if (auth.isStub) {
    return next(req);
  }

  // Non-API URLs (e.g. Descope CDN, Scryfall): skip
  const apiBase = environment.apiBaseUrl;
  const isApi = apiBase ? req.url.startsWith(apiBase) : req.url.startsWith('/');
  if (!isApi) {
    return next(req);
  }

  // Delegate to Descope's interceptor — pulls token from SDK, refreshes on 401
  return descopeInterceptor(req, next);
};
