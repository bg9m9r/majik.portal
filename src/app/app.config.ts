import { ApplicationConfig, ErrorHandler, provideAppInitializer, provideBrowserGlobalErrorListeners, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { provideMajikAuth } from './core/auth/provide-majik-auth';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { provideApiConfiguration } from './core/api/api-configuration';
import { ProfileService } from './core/profile/profile.service';
import { devErrorInterceptor } from './core/dev-error/dev-error.interceptor';
import { DevToastErrorHandler } from './core/dev-error/dev-toast-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // devErrorInterceptor is listed AFTER authInterceptor so its `catchError`
    // observes errors only after auth-refresh has had its retry attempt.
    provideHttpClient(withInterceptors([authInterceptor, devErrorInterceptor])),
    provideApiConfiguration(environment.apiBaseUrl),
    { provide: ErrorHandler, useClass: DevToastErrorHandler },
    ...provideMajikAuth(),
    provideAppInitializer(async () => {
      // Resolve injections synchronously up-front. Calling `inject()`
      // after an `await` throws NG0203 because the synchronous Angular
      // injection context is lost across microtask boundaries.
      //
      // Order still matters at await time: AuthService.bootstrap() must
      // resolve before ProfileService.bootstrap() fires `GET /me`,
      // otherwise the request races the Auth0 redirect-callback token
      // exchange and 401s — which the onboarding guard misreads as
      // "no profile" and bounces the user to /onboarding on every login.
      const auth = inject(AuthService);
      const profile = inject(ProfileService);
      await auth.bootstrap();
      await profile.bootstrap();
    })
  ]
};
