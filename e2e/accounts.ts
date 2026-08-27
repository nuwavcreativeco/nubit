/**
 * Two throwaway accounts, supplied by you, never committed.
 *
 * Copy .env.test.example to .env.test and fill it in. The specs read these
 * at runtime and type them into the real sign-in form, which means the login
 * flow is itself under test.
 *
 * Use accounts that exist only on the test project. The signed-in specs post
 * days, place bids, send offers and book shoots for real — there is no
 * rollback here the way there is in supabase/tests/suite.sql.
 */
export type Role = "shooter" | "creator";

export type Account = {
  email: string;
  password: string;
  /** The profile handle, used to visit /u/<handle>. */
  handle: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is missing. Copy .env.test.example to .env.test and fill it in ` +
        `(playwright.config.ts reads it automatically), then: npm run test:e2e. ` +
        `The public specs need no accounts: npm run test:e2e:public`
    );
  }
  return value;
}

export function account(role: Role): Account {
  const prefix = role === "shooter" ? "E2E_SHOOTER" : "E2E_CREATOR";
  return {
    email: required(`${prefix}_EMAIL`),
    password: required(`${prefix}_PASSWORD`),
    handle: required(`${prefix}_HANDLE`),
  };
}

export const storageStateFor = (role: Role) => `e2e/.auth/${role}.json`;
