import { z } from 'zod';
import { getRepository } from '@/lib/data/repository';
import { aiConfigured, badRequest, notFound } from '@/lib/data/http';
import { baselineScenario } from '@/lib/analytics/model';
import { runClaudeAnalyst, type AnalystEvent } from '@/lib/ai/analyst';
import { runLocalAnalyst } from '@/lib/ai/local';

export const maxDuration = 300;

const Body = z.object({
  companyId: z.string(),
  question: z.string().min(1).max(2000),
  year: z.number().int(),
  scenario: z.object({ customerGrowth: z.number(), pricing: z.number(), crossSellRate: z.number(), retention: z.number(), newVertical: z.number(), costEfficiency: z.number(), verticalPlans: z.record(z.string(), z.object({ extraGrowth: z.number().min(-0.9).max(5), startYear: z.number().int() })).optional() }).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(40).default([]),
});

/** Streams analyst events as newline-delimited JSON. */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest('Invalid request', body.error.issues);
  const { companyId, question, year, history } = body.data;
  const repo = await getRepository();
  const data = await repo.getCompany(companyId);
  if (!data) return notFound(`No company "${companyId}"`);
  const baseline = baselineScenario(data);
  const scenario = body.data.scenario ?? baseline;
  const ctx = { data, year, scenario, baseline, acquisitions: await repo.listAcquisitions(companyId) };
  const scenarioActive = JSON.stringify(scenario) !== JSON.stringify(baseline);

  const events: AsyncIterable<AnalystEvent> | Iterable<AnalystEvent> = aiConfigured()
    ? runClaudeAnalyst(question, history, ctx, scenarioActive)
    : runLocalAnalyst(question, ctx);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const e of events) controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      } catch (e) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : 'Analyst failed' }) + '\n'));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}
