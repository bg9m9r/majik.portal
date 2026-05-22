import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface MajikAuthConfig {
  projectId: string;
  flowId: string;
  baseUrl: string;
  redirectUrl: string;
}

export const MAJIK_AUTH_CONFIG = new InjectionToken<MajikAuthConfig>('MAJIK_AUTH_CONFIG', {
  providedIn: 'root',
  factory: () => environment.descope
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
  if (!cfg.projectId) return true;
  // `?stub=` URL override is dev-only — prod builds always require real auth when a projectId
  // is configured, regardless of query string.
  if (!production && stubInUrl) return true;
  return false;
}

export function isAuthStubbed(cfg: MajikAuthConfig): boolean {
  return computeAuthStubbed(cfg, environment.production, urlForcesStub());
}
