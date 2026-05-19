import { EnvironmentProviders, importProvidersFrom } from '@angular/core';
import { DescopeAuthConfig, DescopeAuthModule } from '@descope/angular-sdk';
import { environment } from '../../../environments/environment';

export function provideMajikAuth(): EnvironmentProviders[] {
  const cfg = environment.descope;
  if (!cfg.projectId) {
    return [];
  }
  const descopeConfig: DescopeAuthConfig = {
    projectId: cfg.projectId,
    baseUrl: cfg.baseUrl || undefined,
    persistTokens: true,
    autoRefresh: true,
    storeLastAuthenticatedUser: true,
    pathsToIntercept: [environment.apiBaseUrl || '/']
  };
  return [importProvidersFrom(DescopeAuthModule.forRoot(descopeConfig))];
}
