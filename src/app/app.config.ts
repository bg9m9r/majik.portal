import { ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { provideMajikAuth } from './core/auth/provide-majik-auth';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { provideApiConfiguration } from './core/api/api-configuration';
import { ProfileService } from './core/profile/profile.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideApiConfiguration(environment.apiBaseUrl),
    ...provideMajikAuth(),
    provideAppInitializer(async () => {
      // Order matters: AuthService.bootstrap() must resolve before
      // ProfileService.bootstrap() fires `GET /me`, otherwise the
      // request races the Auth0 redirect-callback token exchange and
      // 401s — which the onboarding guard misreads as "no profile" and
      // bounces the user to /onboarding on every login.
      await inject(AuthService).bootstrap();
      await inject(ProfileService).bootstrap();
    })
  ]
};
