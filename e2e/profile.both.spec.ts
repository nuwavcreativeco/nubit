import { test, expect, type Page } from "@playwright/test";
import { account, storageStateFor } from "./accounts";
import { recordClip } from "./video";

/**
 * The profile interface: caption editing, likes, comments, moderation and the
 * permalink. These all mutate real rows, so each test works on a reel it
 * created itself rather than whatever happens to be first on the grid.
 */
async function uploadOne(page: Page, handle: string, caption: string) {
  await page.goto(`/u/${handle}`);
  const clip = await recordClip(page, { ms: 800 });
  await page.getByPlaceholder("Caption (optional)").fill(caption);
  await page.locator('input[accept*="video"]').setInputFiles(clip);
  await expect(page.getByText("Added to your grid.")).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Opens a specific tile by its caption. Targeting "the first tile" raced the
 * refresh that follows an upload, and opened whatever was previously newest.
 */
async function openTile(page: Page, caption: string) {
  const tile = page.locator(`button[data-reel-id][aria-label="${caption}"]`);
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.click();
  await expect(page.locator("video[controls]")).toBeVisible({ timeout: 20_000 });
}

test("the owner can caption, and anyone signed in can like and comment", async ({
  browser,
}) => {
  const shooter = account("shooter");

  const shooterCtx = await browser.newContext({
    storageState: storageStateFor("shooter"),
  });
  const creatorCtx = await browser.newContext({
    storageState: storageStateFor("creator"),
  });
  const shooterPage = await shooterCtx.newPage();
  const creatorPage = await creatorCtx.newPage();

  try {
    const stamp = Date.now();
    await uploadOne(shooterPage, shooter.handle, `original ${stamp}`);

    // The caption the upload carried is shown, and the owner can rewrite it.
    await openTile(shooterPage, `original ${stamp}`);
    await expect(shooterPage.getByText(`original ${stamp}`)).toBeVisible();

    await shooterPage.getByRole("button", { name: "Reel options" }).click();
    await shooterPage.getByRole("button", { name: "Edit caption" }).click();
    await shooterPage.locator("textarea").first().fill(`edited ${stamp}`);
    await shooterPage.getByRole("button", { name: "Save", exact: true }).click();
    await expect(shooterPage.getByText(`edited ${stamp}`)).toBeVisible({
      timeout: 20_000,
    });

    // A second person likes it and says something.
    await creatorPage.goto(`/u/${shooter.handle}`);
    await openTile(creatorPage, `edited ${stamp}`);

    await creatorPage.getByRole("button", { name: "Like" }).click();
    await expect(creatorPage.getByText(/\b1 like\b/)).toBeVisible({ timeout: 20_000 });

    const said = `nice work ${stamp}`;
    await creatorPage.getByPlaceholder("Add a comment").fill(said);
    await creatorPage.getByRole("button", { name: "Post" }).click();
    await expect(creatorPage.getByText(said)).toBeVisible({ timeout: 20_000 });

    // The shooter sees it, and can remove it — their grid, their shopfront.
    await shooterPage.reload();
    await openTile(shooterPage, `edited ${stamp}`);
    await expect(shooterPage.getByText(said)).toBeVisible({ timeout: 20_000 });

    await shooterPage
      .locator("div")
      .filter({ hasText: said })
      .getByRole("button", { name: "Delete comment" })
      .first()
      .click();
    await expect(shooterPage.getByText(said)).toBeHidden({ timeout: 20_000 });
  } finally {
    await shooterCtx.close();
    await creatorCtx.close();
  }
});

test("a reel has its own page, and the owner can delete it", async ({ browser }) => {
  const shooter = account("shooter");
  const ctx = await browser.newContext({ storageState: storageStateFor("shooter") });
  const page = await ctx.newPage();

  try {
    const stamp = Date.now();
    await uploadOne(page, shooter.handle, `permalink ${stamp}`);

    // The standalone page shows the same reel as the modal, and carries the
    // owner's name in its title so a pasted link unfurls sensibly.
    const tile = page.locator(
      `button[data-reel-id][aria-label="permalink ${stamp}"]`
    );
    await expect(tile).toBeVisible({ timeout: 30_000 });
    const reelId = await tile.getAttribute("data-reel-id");
    expect(reelId).toBeTruthy();

    await page.goto(`/r/${reelId}`);
    await expect(page.locator("video[controls]")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`permalink ${stamp}`)).toBeVisible();
    await expect(page).toHaveTitle(/E2E Shooter/i);

    // Deleting asks first, then removes the tile.
    await page.goto(`/u/${shooter.handle}`);
    const before = await page.locator("main ul li").count();
    await openTile(page, `permalink ${stamp}`);
    await page.getByRole("button", { name: "Reel options" }).click();
    await page.getByRole("button", { name: "Delete reel" }).click();

    await expect(page.getByText("Delete this reel?")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.locator("main ul li")).toHaveCount(before - 1, {
      timeout: 30_000,
    });
  } finally {
    await ctx.close();
  }
});
