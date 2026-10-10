import { connection } from 'next/server';
import { getRepository } from '@/lib/data/repository';
import { aiConfigured, json } from '@/lib/data/http';
import { authEnabled } from '@/lib/auth/session';

export async function GET() {
  await connection();
  const repo = await getRepository();
  return json({ storage: repo.kind, ai: aiConfigured() ? 'claude' : 'local', auth: authEnabled() ? 'password' : 'none' });
}
