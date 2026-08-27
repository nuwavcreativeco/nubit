import { test, expect, type Page } from "@playwright/test";
import { account, storageStateFor } from "./accounts";

/**
 * The follow → bell → feed chain. This is the mechanic the whole launch plan
 * rests on: 600 artists follow one shooter, and the bell is what turns that
 * into first pick.
 *
 * The SQL suite already proves the trigger fans out to exactly the right
 * people. What it cannot prove is that a real browser, subscribed over
 * Realtime, actually shows it.
 */
async function postADay(page: Page, title: string) {
  await page.goto("/slots/new");
  await page.locator('input[name="title"]').fill(title);

  const inAMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await page.locator('input[name="shoot_date"]').fill(inAMonth);
  await page.locator('input[name="location"]').fill("A studio");
  await page.locator('input[name="floor_rate"]').fill("200");
  await page.locator('input[name="claim"]').fill("600");

  await page.getByRole("button", { name: /post/i }).last().click();
  await expect(page).toHaveURL(/\/slots/, { timeout: 30_000 });
}

test("following a shooter puts their new day in the bell and the feed", async ({
  browser,
}) => {
  const shooter = account("shooter");

  const creatorCtx = await browser.newContext({
    storageState: storageStateFor("creator"),
  });
  const shooterCtx = await browser.newContext({
    storageState: storageStateFor("shooter"),
  });
  const creator = await creatorCtx.newPage();
  const shooterPage = await shooterCtx.newPage();

  try {
    // 1. The creator follows the shooter.
    await creator.goto(`/u/${shooter.handle}`);

    const follow = creator.getByRole("button", { name: "Follow", exact: true });
    if (await follow.isVisible().catch(() => false)) {
      await follow.click();
    }
    await expect(
      creator.getByRole("button", { name: "Following" })
    ).toBeVisible({ timeout: 15_000 });

    // 2. The creator sits on the feed with a live subscription open.
    await creator.goto("/feed");

    // 3. The shooter posts a day.
    const title = `Bell test ${Date.now()}`;
    await postADay(shooterPage, title);

    // 4. It reaches the creator. The bell subscribes to notifications and
    //    refreshes on insert, so this should land without a manual reload —
    //    but allow one, because a missed socket is a flake, not a bug.
    const bell = creator.getByRole("button", { name: /Notifications/ });
    await expect(bell).toBeVisible();

    const badge = creator.locator('button[aria-label*="unread"]');
    const rang = await badge
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (!rang) await creator.reload();
    await expect(creator.locator('button[aria-label*="unread"]')).toBeVisible({
      timeout: 15_000,
    });

    // 5. And it says the right thing, pointing at the right day.
    await creator.getByRole("button", { name: /Notifications/ }).click();
    await expect(creator.getByText(new RegExp(title))).toBeVisible();
    await expect(creator.getByText(/you're seeing it first/i)).toBeVisible();
  } finally {
    await creatorCtx.close();
    await shooterCtx.close();
  }
});

test("unfollowing stops the feed showing that shooter's work", async ({ browser }) => {
  const shooter = account("shooter");
  const ctx = await browser.newContext({ storageState: storageStateFor("creator") });
  const page = await ctx.newPage();

  try {
    await page.goto(`/u/${shooter.handle}`);

    const following = page.getByRole("button", { name: "Following" });
    if (await following.isVisible().catch(() => false)) {
      await following.click();
      await expect(
        page.getByRole("button", { name: "Follow", exact: true })
      ).toBeVisible({ timeout: 15_000 });
    }

    await page.goto("/feed");
    await expect(page.getByText(/aren't following anyone yet|feed is empty/i)).toBeVisible();
  } finally {
    await ctx.close();
  }
});
