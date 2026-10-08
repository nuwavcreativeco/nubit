import { NextResponse } from 'next/server';
import { checkPassword, createSessionToken, SESSION_COOKIE } from '@/lib/auth/session';

export async function POST(request: Request) {
  const form = await request.formData();
  const next = String(form.get('next') ?? '/');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (!checkPassword(String(form.get('password') ?? ''))) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(safeNext)}`, request.url), 303);
  }
  const res = NextResponse.redirect(new URL(safeNext, request.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 14 });
  return res;
}
