import { describe, expect, it } from 'vitest';
import { computeAuthStubbed, type MajikAuthConfig } from './auth.config';

const realCfg: MajikAuthConfig = {
  projectId: 'P_REAL',
  flowId: 'sign-up-or-in',
  baseUrl: '',
  redirectUrl: ''
};

describe('computeAuthStubbed', () => {
  it('returns true when no projectId is configured (any env, any URL)', () => {
    expect(computeAuthStubbed({ ...realCfg, projectId: '' }, false, false)).toBe(true);
    expect(computeAuthStubbed({ ...realCfg, projectId: '' }, true, true)).toBe(true);
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

  it('returns false in dev with no stub param when projectId set', () => {
    expect(computeAuthStubbed(realCfg, false, false)).toBe(false);
  });
});
