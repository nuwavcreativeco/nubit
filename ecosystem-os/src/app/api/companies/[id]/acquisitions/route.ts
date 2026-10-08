import { z } from 'zod';
import { getRepository } from '@/lib/data/repository';
import { badRequest, json } from '@/lib/data/http';

const Body = z.object({
  name: z.string().min(1).max(80),
  price: z.number(), revenue: z.number(), ebitda: z.number(), customers: z.number(), employees: z.number(), growth: z.number(),
  services: z.array(z.string()), segments: z.array(z.string()), geography: z.array(z.string()), infra: z.array(z.string()),
});

export async function GET(_req: Request, ctx: RouteContext<'/api/companies/[id]/acquisitions'>) {
  const { id } = await ctx.params;
  return json(await (await getRepository()).listAcquisitions(id));
}

export async function POST(req: Request, ctx: RouteContext<'/api/companies/[id]/acquisitions'>) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest('Invalid acquisition', body.error.issues);
  const target = { ...body.data, id: crypto.randomUUID(), companyId: id, createdAt: new Date().toISOString() };
  await (await getRepository()).saveAcquisition(target);
  return json(target, 201);
}
