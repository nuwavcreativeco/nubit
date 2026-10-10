/**
 * Authentication boundary. Default mode is open (local single-user). Setting APP_PASSWORD turns on a
 * shared-password gate with a signed HttpOnly cookie. Swap this module for Supabase Auth / SSO
 * without touching routes: callers only use `authEnabled`, `createSessionToken` and `verifySessionToken`.
 */
export const SESSION_COOKIE = 'eos_session';

export const authEnabled = () => !!process.env.APP_PASSWORD;

const secret = () => process.env.AUTH_SECRET ?? process.env.APP_PASSWORD ?? '';

async function hmac(value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionToken() {
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 14;
  return `${expires}.${await hmac(String(expires))}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  const expected = await hmac(expires);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export function checkPassword(input: string) {
  const expected = process.env.APP_PASSWORD ?? '';
  if (!expected || input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
