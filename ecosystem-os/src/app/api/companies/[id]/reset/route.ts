import { getRepository } from '@/lib/data/repository';
import { json, notFound } from '@/lib/data/http';

export async function POST(_req: Request, ctx: RouteContext<'/api/companies/[id]/reset'>) {
  const { id } = await ctx.params;
  const company = await (await getRepository()).resetCompany(id);
  return company ? json(company) : notFound(`No built-in dataset for "${id}"`);
}
