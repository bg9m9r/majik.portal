import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { appConfig } from './app.config';
import { AuthUserStore } from './core/auth/auth-user.store';

/**
 * Regression coverage for NG0203 ("inject() must be called from an injection
 * context") at app bootstrap.
 *
 * Calling `inject()` after an `await` inside an async `provideAppInitializer`
 * callback throws — the synchronous Angular injection context is gone across
 * the microtask boundary. PR #25 had that bug and blanked the production app.
 *
 * The fix in app.config.ts must resolve ALL `inject(...)` calls synchronously
 * before the first `await`. We exercise the real `appConfig.providers` via
 * `ApplicationInitStatus.donePromise`, which rejects iff any initializer
 * throws. The stub uses a microtask-yielding `bootstrap()` so the buggy
 * "inject after await" pattern would fail this test.
 *
 * Since the store-sweep, identity is bootstrapped by a single
 * AuthUserStore.bootstrap() (which internally settles auth then loads the
 * profile) rather than the prior AuthService + ProfileService two-step.
 */
describe('appConfig app initializer', () => {
  let storeBootstrap: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Force a real microtask boundary inside the initializer; this is what
    // surfaces NG0203 when inject() is called after await.
    storeBootstrap = vi.fn(async () => {
      await Promise.resolve();
    });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        // Override the real store AFTER appConfig.providers so this wins.
        { provide: AuthUserStore, useValue: { bootstrap: storeBootstrap } },
      ],
    });
  });

  it('runs all app initializers without NG0203', async () => {
    const initStatus = TestBed.inject(ApplicationInitStatus);
    // donePromise resolves once every initializer settles. If any initializer
    // throws (e.g. NG0203 from inject-after-await) the await rejects and the
    // test fails naturally.
    await initStatus.donePromise;
    expect(initStatus.done).toBe(true);
  });

  it('bootstraps the AuthUserStore once', async () => {
    const initStatus = TestBed.inject(ApplicationInitStatus);
    await initStatus.donePromise;

    expect(storeBootstrap).toHaveBeenCalledTimes(1);
  });
});
