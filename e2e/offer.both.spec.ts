import { test, expect } from "@playwright/test";
import { account, storageStateFor } from "./accounts";

/**
 * Messaging and the direct offer, end to end across two real sessions.
 *
 * The offer is the one flow where a click books a shoot and moves the deal
 * onto the ledger, so this is the spec worth trusting least until it has run.
 */
test("a cold message lands in requests, and a followed one in primary", async ({
  browser,
}) => {
  const shooter = account("shooter");
  const creator = account("creator");

  const creatorCtx = await browser.newContext({
    storageState: storageStateFor("creator"),
  });
  const shooterCtx = await browser.newContext({
    storageState: storageStateFor("shooter"),
  });
  const creatorPage = await creatorCtx.newPage();
  const shooterPage = await shooterCtx.newPage();

  try {
    // Strangers means neither direction: my_inbox treats a follow either way
    // as primary, and an earlier run leaves the shooter following the creator.
    for (const [page, handle] of [
      [creatorPage, shooter.handle],
      [shooterPage, creator.handle],
    ] as const) {
      await page.goto(`/u/${handle}`);
      const following = page.getByRole("button", { name: "Following" });
      if (await following.isVisible().catch(() => false)) {
        await following.click();
        await expect(
          page.getByRole("button", { name: "Follow", exact: true })
        ).toBeVisible();
      }
    }

    // The creator writes to the shooter, who does not follow back.
    const note = `cold ${Date.now()}`;
    await creatorPage.getByRole("button", { name: "Message" }).click();
    await expect(creatorPage).toHaveURL(/\/inbox\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await creatorPage.getByPlaceholder("Write a message").fill(note);
    await creatorPage.getByRole("button", { name: "Send", exact: true }).click();
    await expect(creatorPage.getByText(note)).toBeVisible({ timeout: 20_000 });

    // Nothing is blocked — it is only sorted. It belongs in requests.
    await shooterPage.goto("/inbox?box=requests");
    await expect(shooterPage.getByText(note)).toBeVisible({ timeout: 20_000 });

    await shooterPage.goto("/inbox");
    await expect(shooterPage.getByText(note)).toBeHidden();

    // Once the shooter follows back, the same thread is primary.
    await shooterPage.goto(`/u/${creator.handle}`);
    const follow = shooterPage.getByRole("button", { name: "Follow", exact: true });
    if (await follow.isVisible().catch(() => false)) await follow.click();
    await expect(shooterPage.getByRole("button", { name: "Following" })).toBeVisible();

    await shooterPage.goto("/inbox");
    await expect(shooterPage.getByText(note)).toBeVisible({ timeout: 20_000 });
  } finally {
    await creatorCtx.close();
    await shooterCtx.close();
  }
});

test("an accepted direct offer books a real, reviewable day", async ({ browser }) => {
  const creator = account("creator");

  const shooterCtx = await browser.newContext({
    storageState: storageStateFor("shooter"),
  });
  const creatorCtx = await browser.newContext({
    storageState: storageStateFor("creator"),
  });
  const shooterPage = await shooterCtx.newPage();
  const creatorPage = await creatorCtx.newPage();

  try {
    // The shooter browses the creator's grid and reaches out.
    await shooterPage.goto(`/u/${creator.handle}`);
    await shooterPage.getByRole("button", { name: "Message" }).click();
    await expect(shooterPage).toHaveURL(/\/inbox\/[0-9a-f-]{36}/, { timeout: 20_000 });

    const title = `Offer ${Date.now()}`;
    await shooterPage.getByRole("button", { name: /Send a direct offer/i }).click();

    await shooterPage.locator('input[name="title"]').fill(title);
    await shooterPage.locator('input[name="location"]').fill("A studio");
    await shooterPage.locator('input[name="price"]').fill("1200");
    await shooterPage.getByRole("button", { name: "Send offer" }).click();

    const sentCard = shooterPage.getByTestId("offer-card").filter({ hasText: title });
    await expect(sentCard).toBeVisible({ timeout: 20_000 });
    await expect(sentCard.getByText("pending")).toBeVisible();

    // The creator sees it and accepts. Go straight to the thread rather than
    // guessing which inbox row it is — the offer lands in primary or requests
    // depending on who follows whom, and both boxes may hold other threads
    // from earlier runs.
    const conversationUrl = new URL(shooterPage.url()).pathname;
    await creatorPage.goto(conversationUrl);

    const card = creatorPage.getByTestId("offer-card").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText("$1,200")).toBeVisible();

    await card.getByRole("button", { name: /Accept and book/i }).click();

    // Accepting writes a settled slot, which is what keeps the deal on the
    // ledger — and therefore reviewable and countable.
    await expect(card.getByText("accepted")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("link", { name: /Booked — see the day/i })).toBeVisible();

    await card.getByRole("link", { name: /Booked — see the day/i }).click();
    await expect(creatorPage).toHaveURL(/\/slots\/[0-9a-f-]{36}/);
    await expect(creatorPage.getByText(/^won$/i)).toBeVisible();

    // The same offer cannot be taken twice.
    await creatorPage.goBack();
    await expect(
      creatorPage
        .getByTestId("offer-card")
        .filter({ hasText: title })
        .getByRole("button", { name: /Accept and book/i })
    ).toBeHidden();
  } finally {
    await shooterCtx.close();
    await creatorCtx.close();
  }
});
