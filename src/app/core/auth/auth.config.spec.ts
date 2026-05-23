import { describe, expect, it } from 'vitest';
import { computeAuthStubbed, type MajikAuthConfig } from './auth.config';

const realCfg: MajikAuthConfig = {
  domain: 'auth.majik.tech',
  clientId: 'real-spa-client-id',
  audience: 'https://api.majik.tech',
  redirectUri: 'http://localhost:4200/auth/callback'
};

describe('computeAuthStubbed', () => {
  it('returns true when no clientId is configured (any env, any URL)', () => {
    expect(computeAuthStubbed({ ...realCfg, clientId: '' }, false, false)).toBe(true);
    expect(computeAuthStubbed({ ...realCfg, clientId: '' }, true, true)).toBe(true);
  });

  it('returns true when no domain is configured', () => {
    expect(computeAuthStubbed({ ...realCfg, domain: '' }, true, false)).toBe(true);
  });

  it('honors ?stub= in non-production builds', () => {
    expect(computeAuthStubbed(realCfg, false, true)).toBe(true);
  });

  it('IGNORES ?stub= in production builds', () => {
    expect(computeAuthStubbed(realCfg, true, true)).toBe(false);
  });

  it('returns false in production with no stub param', () => {
    expect(computeAuthStubbed(realCfg, true, false)).toBe(false);
  });

  it('returns false in dev with no stub param when Auth0 is configured', () => {
    expect(computeAuthStubbed(realCfg, false, false)).toBe(false);
  });
});
