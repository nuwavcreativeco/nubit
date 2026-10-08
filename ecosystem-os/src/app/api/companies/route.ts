import { connection } from 'next/server';
import { getRepository } from '@/lib/data/repository';
import { json } from '@/lib/data/http';

export async function GET() {
  await connection(); // always read live storage, never a build-time snapshot
  const repo = await getRepository();
  return json(await repo.listCompanies());
}
