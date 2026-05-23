import { EnvironmentProviders } from '@angular/core';
import { provideAuth0 } from '@auth0/auth0-angular';
import { environment } from '../../../environments/environment';

/**
 * Wires the Auth0 SPA SDK. Returns an empty providers list when no Auth0
 * tenant is configured (stub mode) so the app still bootstraps for local
 * dev / unit tests without hitting Auth0.
 *
 * `cacheLocation: 'localstorage'` survives full-page reloads so users
 * don't have to re-auth on every refresh. `useRefreshTokens` turns on
 * refresh-token rotation (configured on the Auth0 application as well —
 * Rotating in the dashboard).
 *
 * `redirect_uri` MUST match one of the SPA app's Allowed Callback URLs
 * in the Auth0 dashboard, or the OAuth round-trip fails after Discord
 * with "Callback URL mismatch".
 */
export function provideMajikAuth(): EnvironmentProviders[] {
  const cfg = environment.auth0;
  if (!cfg.clientId || !cfg.domain) {
    return [];
  }
  return [
    provideAuth0({
      domain: cfg.domain,
      clientId: cfg.clientId,
      cacheLocation: 'localstorage',
      useRefreshTokens: true,
      authorizationParams: {
        redirect_uri: cfg.redirectUri,
        audience: cfg.audience,
        scope: 'openid profile email offline_access'
      }
    })
  ];
}
