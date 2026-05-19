import { test, expect } from '@playwright/test';

/**
 * First-login onboarding smoke. Stub auth via ?stub=name.
 *
 * Prereqs (start manually before running):
 *   - Majik.Server on :5057 with CORS allowing :4200, Mongo configured
 *   - Local Mongo (docker compose -f majik.core/docker-compose.dev.yml up -d)
 *   - ng serve on :4200
 *   - Clean userProfiles collection (or use a unique handle each run)
 */

test.describe('onboarding', () => {
  test('first login goes to onboarding, save handle, lands in lobby', async ({ page }) => {
    const handle = 'alice' + Math.floor(Math.random() * 100000);

    await page.goto(`/?stub=${handle}-stub`);
    await page.waitForURL(/\/onboarding/, { timeout: 10_000 });

    await page.getByRole('textbox').fill(handle);
    await page.getByRole('button', { name: 'Save' }).click();

    await page.waitForURL(/\/lobby/, { timeout: 10_000 });
    await expect(page.getByText(handle)).toBeVisible();
  });

  test('reload after onboarding keeps you in lobby', async ({ page }) => {
    const handle = 'alice' + Math.floor(Math.random() * 100000);

    await page.goto(`/?stub=${handle}-stub`);
    await page.waitForURL(/\/onboarding/);
    await page.getByRole('textbox').fill(handle);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/lobby/);

    await page.reload();
    await expect(page).toHaveURL(/\/lobby/);
    await expect(page.getByText(handle)).toBeVisible();
  });
});
