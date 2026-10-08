import { z } from 'zod';
import { getRepository } from '@/lib/data/repository';
import { badRequest, json } from '@/lib/data/http';

const Body = z.object({
  name: z.string().min(1).max(80),
  params: z.object({ customerGrowth: z.number(), pricing: z.number(), crossSellRate: z.number(), retention: z.number(), newVertical: z.number(), costEfficiency: z.number(), verticalPlans: z.record(z.string(), z.object({ extraGrowth: z.number().min(-0.9).max(5), startYear: z.number().int() })).optional() }),
});

export async function GET(_req: Request, ctx: RouteContext<'/api/companies/[id]/scenarios'>) {
  const { id } = await ctx.params;
  return json(await (await getRepository()).listScenarios(id));
}

export async function POST(req: Request, ctx: RouteContext<'/api/companies/[id]/scenarios'>) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest('Invalid scenario', body.error.issues);
  const scenario = { id: crypto.randomUUID(), companyId: id, ...body.data, createdAt: new Date().toISOString() };
  await (await getRepository()).saveScenario(scenario);
  return json(scenario, 201);
}
