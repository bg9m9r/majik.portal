import { ApplicationConfig, ErrorHandler, provideAppInitializer, provideBrowserGlobalErrorListeners, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { provideMajikAuth } from './core/auth/provide-majik-auth';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthUserStore } from './core/auth/auth-user.store';
import { provideApiConfiguration } from './core/api/api-configuration';
import { devErrorInterceptor } from './core/dev-error/dev-error.interceptor';
import { prodErrorInterceptor } from './core/error/prod-error.interceptor';
import { ProdErrorHandler } from './core/error/prod-error';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // prodErrorInterceptor + devErrorInterceptor are listed AFTER
    // authInterceptor so their `catchError` observes errors only after
    // auth-refresh has had its retry attempt. prodErrorInterceptor surfaces
    // a generic, safe user-facing toast; devErrorInterceptor keeps the
    // opt-in verbose dev detail.
    provideHttpClient(withInterceptors([authInterceptor, prodErrorInterceptor, devErrorInterceptor])),
    provideApiConfiguration(environment.apiBaseUrl),
    // ProdErrorHandler is the always-on surface (generic toast for uncaught
    // JS errors) and delegates to DevToastErrorHandler for dev detail +
    // console.error.
    { provide: ErrorHandler, useClass: ProdErrorHandler },
    ...provideMajikAuth(),
    provideAppInitializer(async () => {
      // Resolve the injection synchronously up-front. Calling `inject()`
      // after an `await` throws NG0203 because the synchronous Angular
      // injection context is lost across microtask boundaries.
      //
      // AuthUserStore.bootstrap() internally settles the Auth0/Descope
      // session BEFORE firing `GET /me` — the order still matters because
      // the profile request must not race the Auth0 redirect-callback
      // token exchange (a 401 there used to make the onboarding guard
      // misread "no profile" and bounce returning users to /onboarding on
      // every login). Consolidating both into one store keeps that
      // ordering internal to bootstrap().
      const store = inject(AuthUserStore);
      await store.bootstrap();
    })
  ]
};
