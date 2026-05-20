import { Browser, BrowserContext, Page, expect, test } from '@playwright/test';

/**
 * Two-context smoke: alice creates a game, bob joins, both claim seats,
 * alice starts the game. Stub auth via ?stub=name URL param so we don't
 * round-trip Discord/Descope on every CI run.
 *
 * Prereqs (start manually before running):
 *   - Majik.Server on :5057 with CORS allowing :4200
 *   - ng serve on :4200
 */

async function openAs(browser: Browser, stubName: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?stub=${stubName}`);

  // Walk onboarding if first time.
  try {
    await page.waitForURL(/\/onboarding/, { timeout: 2_000 });
    const handle = stubName + '-' + Math.floor(Math.random() * 100000);
    await page.getByRole('textbox').fill(handle);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForURL(/\/lobby/, { timeout: 10_000 });
  } catch {
    // Already onboarded — proceed.
  }

  await expect(page).toHaveURL(/\/(lobby|login)/);
  return { context, page };
}

test.describe('two-player smoke', () => {
  test('alice creates public match, bob joins, both observe rolling', async ({ browser }) => {
    const alice = await openAs(browser, 'alice');
    const bob = await openAs(browser, 'bob');

    // Alice creates a public match via wizard
    await alice.page.goto('/lobby');
    await alice.page.getByRole('textbox').fill('starter-burn');
    // Public toggle already default; 20 min already default
    await alice.page.getByRole('button', { name: 'Create match' }).click();
    await alice.page.waitForURL(/\/match\/[0-9a-f-]+/, { timeout: 10_000 });

    const matchUrl = new URL(alice.page.url()).pathname;
    expect(matchUrl).toMatch(/\/match\/[0-9a-f-]+/);

    // Bob opens lobby, sees the public match, clicks Open
    await bob.page.goto('/lobby');
    await bob.page.waitForTimeout(1_000); // Wait for list to load
    await bob.page.getByRole('button', { name: 'Open' }).first().click();
    await bob.page.waitForURL(/\/match\/[0-9a-f-]+/, { timeout: 10_000 });

    // Both observe Rolling state
    await expect(alice.page.getByText(/Roll for first player|Starting|Opponent joined/i)).toBeVisible({ timeout: 10_000 });
    await expect(bob.page.getByText(/Roll for first player|Starting|Opponent joined/i)).toBeVisible({ timeout: 10_000 });

    await alice.context.close();
    await bob.context.close();
  });
});
