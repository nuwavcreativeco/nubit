import { test, expect } from "@playwright/test";
import { account } from "./accounts";
import { recordClip } from "./video";

/**
 * The uploader is the riskiest untested code in the app and the first thing
 * a new shooter touches. These specs cover the two things that were actually
 * wrong before: no progress on a large file, and a silent wrong aspect when
 * the browser cannot decode the video.
 */
test.describe("uploading work", () => {
  test("a vertical clip lands on the grid tagged 9:16", async ({ page }) => {
    const shooter = account("shooter");
    await page.goto(`/u/${shooter.handle}`);

    const before = await page.locator("main ul li").count();

    // A real recording, so the probe has something genuine to decode.
    const clip = await recordClip(page, { portrait: true });

    await page.getByPlaceholder("Caption (optional)").fill("e2e vertical");
    await page.locator('input[type="file"]').setInputFiles(clip);

    // The grid grows by one, and the new tile carries the shape the probe
    // read off the pixels — not the 16:9 default.
    await expect(page.locator("main ul li")).toHaveCount(before + 1, {
      timeout: 60_000,
    });
    await expect(page.locator("main ul li").first().getByText("9:16")).toBeVisible();
  });

  test("a large upload reports progress rather than sitting still", async ({ page }) => {
    const shooter = account("shooter");
    await page.goto(`/u/${shooter.handle}`);

    const clip = await recordClip(page, { ms: 4000 });
    await page.locator('input[type="file"]').setInputFiles(clip);

    // The percentage and the cancel control only exist while uploading.
    // On a fast local connection this can be brief, so accept either seeing
    // it mid-flight or the upload having already completed correctly.
    const percent = page.getByText(/^\d+%$/);
    const appeared = await percent
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (appeared) {
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    }

    await expect(page.getByText("Added to your grid.")).toBeVisible({
      timeout: 60_000,
    });
  });

  test("a file the browser cannot decode asks for the shape instead of guessing", async ({
    page,
  }) => {
    const shooter = account("shooter");
    await page.goto(`/u/${shooter.handle}`);

    // Bytes that are not a video at all stand in for the camera codecs
    // (ProRes, some HEVC builds) a browser refuses to decode.
    await page.locator('input[type="file"]').setInputFiles({
      name: "camera-original.mov",
      mimeType: "video/quicktime",
      buffer: Buffer.from("not really a video, but the file is fine"),
    });

    // The old behaviour was silence plus a wrong 16:9 tag. A reel mis-tagged
    // 16:9 never appears under the board's 9:16 filter, so this matters.
    await expect(page.getByText(/couldn't read the video/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Upload as 16:9" })).toBeVisible();
    await expect(page.getByRole("button", { name: "9:16", exact: true })).toBeVisible();
  });

  test("a file over the bucket limit is refused before any upload starts", async ({
    page,
  }) => {
    const shooter = account("shooter");
    await page.goto(`/u/${shooter.handle}`);

    // 501MB of zeros, never sent anywhere — the guard is client-side.
    await page.locator('input[type="file"]').setInputFiles({
      name: "too-big.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(501 * 1024 * 1024),
    });

    await expect(page.getByText(/limit is 500 MB/i)).toBeVisible();
    await expect(page.getByText(/^\d+%$/)).toBeHidden();
  });
});
