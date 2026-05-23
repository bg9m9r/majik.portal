import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface MajikAuthConfig {
  /** Auth0 tenant domain (custom or `*.auth0.com`). Empty disables auth (stub mode). */
  domain: string;
  /** Auth0 SPA application Client ID (PKCE, no secret). */
  clientId: string;
  /** Auth0 API identifier — issued as the JWT `aud` claim, matched server-side. */
  audience: string;
  /** Where Auth0 redirects after the OAuth round-trip. Must be in the SPA app's Allowed Callback URLs. */
  redirectUri: string;
}

export const MAJIK_AUTH_CONFIG = new InjectionToken<MajikAuthConfig>('MAJIK_AUTH_CONFIG', {
  providedIn: 'root',
  factory: () => environment.auth0
});

function urlForcesStub(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URL(window.location.href).searchParams;
    return params.has('stub');
  } catch {
    return false;
  }
}

/**
 * Pure decision function — separated for testability. `production` is passed in so tests can
 * exercise both code paths without needing to mock the environment module.
 */
export function computeAuthStubbed(cfg: MajikAuthConfig, production: boolean, stubInUrl: boolean): boolean {
  if (!cfg.clientId || !cfg.domain) return true;
  // `?stub=` URL override is dev-only — prod builds always require real auth when an Auth0
  // tenant is configured, regardless of query string.
  if (!production && stubInUrl) return true;
  return false;
}

export function isAuthStubbed(cfg: MajikAuthConfig): boolean {
  return computeAuthStubbed(cfg, environment.production, urlForcesStub());
}
