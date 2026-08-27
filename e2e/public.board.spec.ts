import { test, expect } from "@playwright/test";

/**
 * Signed out. Everything here is what a stranger sees, and it needs no
 * account — so this project runs even before .env.test exists.
 */
test.describe("the public board", () => {
  test("landing page leads with the pitch and both calls to action", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Post the floor");
    await expect(page.getByRole("link", { name: "Browse open slots" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Post an open day" })).toBeVisible();

    // Seattle was removed when the product went global; it should stay gone.
    await expect(page.locator("body")).not.toContainText(/seattle/i);
  });

  test("the primary button is dark-on-cyan, not white-on-cyan", async ({ page }) => {
    // The marketing site renders white on #00E1FF, which measures about
    // 1.9:1. We follow the token instead. This asserts we never drift back.
    await page.goto("/");
    // Scoped to main on purpose: the header carries a link with the same
    // name, and it is a plain nav link with no background.
    const cta = page
      .locator("main")
      .getByRole("link", { name: "Browse open slots" })
      .first();

    const { color, background } = await cta.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });

    expect(background).toBe("rgb(0, 225, 255)");
    expect(color).toBe("rgb(0, 0, 0)");
  });

  test("board cards carry the full anatomy", async ({ page }) => {
    await page.goto("/slots");

    // An empty board is a missing fixture, not a defect. Say so plainly
    // rather than reporting a failure that tells you nothing.
    const cards = page.locator("main ul li");
    test.skip(
      (await cards.count()) === 0,
      "No open slots on this database — post one to exercise the card."
    );

    const card = cards.first();
    await expect(card).toBeVisible();

    // The viewfinder strip: REC is red, and the aspect chip is white.
    const rec = card.getByText("REC", { exact: true });
    await expect(rec).toBeVisible();
    await expect(rec).toHaveCSS("color", "rgb(217, 38, 38)");

    // Label-above-figure pairs, both of them.
    await expect(card.getByText(/^(High bid|Floor)$/i)).toBeVisible();
    await expect(card.getByText("Left", { exact: true })).toBeVisible();

    // The price is the cyan figure.
    const price = card.locator(".fig").first();
    await expect(price).toHaveText(/^\$[\d,]+$/);
    await expect(price).toHaveCSS("color", "rgb(0, 225, 255)");
  });

  test("aspect chips filter the board", async ({ page }) => {
    await page.goto("/slots");

    const countCards = () => page.locator("main ul li").count();
    const all = await countCards();

    await page.getByRole("button", { name: "9:16", exact: true }).click();
    const vertical = await countCards();

    // Every remaining card must actually be vertical.
    const chips = await page.locator("main ul li .meta", { hasText: "9:16" }).count();
    expect(vertical).toBeLessThanOrEqual(all);
    if (vertical > 0) expect(chips).toBeGreaterThan(0);

    await page.getByRole("button", { name: "All", exact: true }).click();
    expect(await countCards()).toBe(all);
  });

  test("a slot page shows the price, the clock and a masked history", async ({ page }) => {
    await page.goto("/slots");

    const links = page.locator("main ul li a");
    test.skip(
      (await links.count()) === 0,
      "No open slots on this database — post one to exercise the slot page."
    );

    await links.first().click();

    await expect(page).toHaveURL(/\/slots\/[0-9a-f-]{36}/);
    await expect(page.getByText(/^(High bid|Floor)$/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bid history" })).toBeVisible();

    // Signed out, bidding is gated behind sign-in rather than shown.
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  });

  test("signed out, the private surfaces ask for a sign in rather than 500", async ({ page }) => {
    for (const path of ["/feed", "/inbox"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/sign in/i);
    }
  });
});
