import { getRepository } from '@/lib/data/repository';
import { badRequest, json, notFound } from '@/lib/data/http';
import { parseCompany } from '@/lib/domain/schema';

export async function GET(_req: Request, ctx: RouteContext<'/api/companies/[id]'>) {
  const { id } = await ctx.params;
  const company = await (await getRepository()).getCompany(id);
  return company ? json(company) : notFound(`No company "${id}"`);
}

export async function PUT(req: Request, ctx: RouteContext<'/api/companies/[id]'>) {
  const { id } = await ctx.params;
  const parsed = parseCompany(await req.json().catch(() => null));
  if (!parsed.ok) return badRequest('Company data failed validation', parsed.errors);
  if (parsed.data.meta.id !== id) return badRequest(`meta.id "${parsed.data.meta.id}" does not match URL id "${id}"`);
  await (await getRepository()).saveCompany(parsed.data);
  return json(parsed.data);
}
