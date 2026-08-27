import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Load .env.test without pulling in another dependency. Values already in the
// environment win, so CI secrets override the file.
try {
  for (const line of readFileSync(".env.test", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
} catch {
  // No .env.test — the `public` project still runs without one.
}

/**
 * Point this at the test project, never production. The signed-in specs
 * create real rows — reels, follows, offers, bookings — and there is no
 * rollback the way there is in the SQL suite.
 *
 * See README: link the repo to nubid-test and `supabase db push` first.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // The auction is full of clocks; give assertions room without being slow.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // the specs share two accounts and one board
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    // Uploading a reel takes a while even locally.
    actionTimeout: 30_000,
  },

  projects: [
    { name: "public", testMatch: /public\..*\.spec\.ts/ },

    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "shooter",
      testMatch: /.*\.shooter\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/shooter.json" },
    },
    {
      name: "creator",
      testMatch: /.*\.creator\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/creator.json" },
    },
    {
      // Two-party flows drive both sessions in one spec.
      name: "both",
      testMatch: /.*\.both\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
