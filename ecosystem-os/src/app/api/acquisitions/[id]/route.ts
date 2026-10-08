import { getRepository } from '@/lib/data/repository';

export async function DELETE(_req: Request, ctx: RouteContext<'/api/acquisitions/[id]'>) {
  const { id } = await ctx.params;
  await (await getRepository()).deleteAcquisition(id);
  return new Response(null, { status: 204 });
}
