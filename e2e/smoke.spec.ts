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
  await expect(page).toHaveURL(/\/(lobby|login)/);
  return { context, page };
}

test.describe('two-player smoke', () => {
  test('alice creates, bob joins, seats claimed, game starts', async ({ browser }) => {
    const alice = await openAs(browser, 'alice');
    const bob = await openAs(browser, 'bob');

    // Alice creates a game
    await alice.page.goto('/lobby');
    await alice.page.getByRole('button', { name: 'Create game' }).click();
    await alice.page.waitForURL(/\/game\/[0-9a-f-]+/, { timeout: 10_000 });

    const gameUrl = new URL(alice.page.url()).pathname;
    expect(gameUrl).toMatch(/\/game\/[0-9a-f-]+/);

    // Both claim seats — alice grabs first, bob the other
    await alice.page.getByRole('button', { name: 'Claim' }).first().click();
    await expect(alice.page.getByRole('button', { name: 'Yours' })).toBeVisible({ timeout: 5_000 });

    await bob.page.goto(gameUrl);
    await bob.page.getByRole('button', { name: 'Claim' }).first().click();
    await expect(bob.page.getByRole('button', { name: 'Yours' })).toBeVisible({ timeout: 5_000 });

    // Alice starts the game
    await alice.page.getByRole('button', { name: 'Start game' }).click();
    await expect(alice.page.getByText(/Game started/i)).toBeVisible({ timeout: 10_000 });

    // Hub state should flip to 'open' on both sides
    await expect(alice.page.getByText(/hub: open/)).toBeVisible({ timeout: 5_000 });
    await expect(bob.page.getByText(/hub: open/)).toBeVisible({ timeout: 5_000 });

    await alice.context.close();
    await bob.context.close();
  });
});
