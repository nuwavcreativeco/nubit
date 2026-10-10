import { getRepository } from '@/lib/data/repository';

export async function DELETE(_req: Request, ctx: RouteContext<'/api/scenarios/[id]'>) {
  const { id } = await ctx.params;
  await (await getRepository()).deleteScenario(id);
  return new Response(null, { status: 204 });
}
