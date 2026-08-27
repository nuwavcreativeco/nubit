import { test as setup, expect } from "@playwright/test";
import { account, storageStateFor, type Role } from "./accounts";

/**
 * Signs both accounts in through the real form and saves the resulting
 * cookies, so the rest of the suite starts already authenticated.
 *
 * Going through the UI rather than seeding cookies directly is deliberate:
 * @supabase/ssr stores the session as chunked cookies whose format is an
 * implementation detail, and reverse-engineering it would give a suite that
 * passes while real sign-in is broken. This way the login path is covered by
 * the act of setting up.
 */
async function signIn(role: Role, page: import("@playwright/test").Page) {
  const who = account(role);

  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The header only renders the avatar link once there's a session.
  await expect(
    page.getByRole("link", { name: "Your profile" })
  ).toBeVisible({ timeout: 20_000 });

  await page.context().storageState({ path: storageStateFor(role) });
}

setup("sign in as the shooter", async ({ page }) => {
  await signIn("shooter", page);
});

setup("sign in as the creator", async ({ page }) => {
  await signIn("creator", page);
});
