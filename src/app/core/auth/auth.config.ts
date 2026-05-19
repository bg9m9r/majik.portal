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

export function isAuthStubbed(cfg: MajikAuthConfig): boolean {
  return !cfg.projectId || urlForcesStub();
}
