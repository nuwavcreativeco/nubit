import { z } from 'zod';
import type { CompanyData } from './types';

// Runtime contract for company data. Every connector (CSV, Stripe, HubSpot, …) must emit
// something that parses against this schema; the analytics engine only ever sees parsed data.

const ratio = z.number().min(-1).max(5);
const share = z.number().min(0).max(1);
const money = z.number();
const series = z.record(z.string().regex(/^\d{4}$/), z.number());
const status = z.record(z.string(), z.enum(['actual', 'estimated', 'projected', 'ai', 'user'])).optional();
const id = z.string().min(1).max(80);

export const ParentSchema = z.object({
  id, status,
  name: z.string(),
  tagline: z.string(),
  currentYear: z.number().int(),
  years: z.array(z.number().int()).min(1),
  cash: money,
  monthlyOpex: money,
  workingCapitalMonths: z.number(),
  debt: money,
  topCustomerShare: share,
  markets: z.array(z.string()),
});

export const VerticalSchema = z.object({
  id, status,
  name: z.string(),
  hue: z.number().min(0).max(360),
  icon: z.string(),
  description: z.string(),
  launchYear: z.number().int().optional(),
  sunsetYear: z.number().int().optional(),
  revenue: series,
  projectedGrowth: ratio,
  grossMargin: ratio,
  ebitdaMargin: ratio,
  contributionMargin: ratio,
  customers: z.number().nonnegative(),
  employees: z.number().nonnegative(),
  recurringShare: share,
  cac: money,
  ltv: money,
  retention: share,
  tam: money,
  sam: money,
  strategicImportance: z.number().min(0).max(10),
  growthPotential: z.number().min(0).max(10),
  marketingSpend: money,
  requiredInvestment: money,
  b2b: z.boolean(),
  ops: z.object({
    leadsPerMonth: z.number(),
    leadsNeeded: z.number(),
    utilization: z.number().min(0).max(1.5),
    keyPersonRisk: share,
    topCustomerShare: share,
  }),
  expansion: z.array(z.object({ market: z.string(), sizeRatio: z.number(), capture: share, investment: money, months: z.number() })).optional(),
  supplyChain: z.object({ name: z.string(), externalSpend: money, inHouseSavingsRate: share, investment: money }).optional(),
  risks: z.array(z.string()),
});

export const ProductSchema = z.object({
  id, status,
  vertical: id,
  name: z.string(),
  revenue: series,
  atv: money,
  margin: ratio,
  customers: z.number().nonnegative(),
  growth: ratio,
  repeatRate: share,
  attachRate: share,
  recurring: z.boolean(),
  capabilities: z.array(z.string()),
  upsell: z.object({ to: z.string(), priceUplift: money, rate: share }).optional(),
  launchYear: z.number().int().optional(),
  sunsetYear: z.number().int().optional(),
});

export const SegmentSchema = z.object({
  id, status,
  name: z.string(),
  description: z.string(),
  customers: z.number().nonnegative(),
  revenue: money,
  retention: share,
  crossSellPotential: share,
  purchases: z.array(z.object({ product: id, revenue: money })),
  b2b: z.boolean(),
});

export const InfraSchema = z.object({
  id, status,
  name: z.string(),
  category: z.enum(['crm', 'web', 'data', 'ai', 'payments', 'distribution', 'location', 'other']),
  annualCost: money,
  techDebt: share,
  dependents: z.array(id),
  externalizable: z.object({ offer: z.string(), customers: z.number(), price: money, confidence: share, investment: money }).optional(),
  dataRecords: z.number().optional(),
});

export const FunctionSchema = z.object({
  id, status,
  name: z.string(),
  fte: z.number(),
  annualCost: money,
  serves: z.array(id),
  utilization: z.number().min(0).max(1.5),
  keyPersonRisk: share,
});

export const PairSchema = z.object({
  status,
  a: id,
  b: id,
  sharedCustomers: z.number().nonnegative(),
  eligibleAtoB: z.number().nonnegative(),
  eligibleBtoA: z.number().nonnegative(),
  currentCrossSellRate: share,
  targetCrossSellRate: share,
  crossSellRevenue: money,
  sharedInfra: z.array(id),
  sharedEmployeesFTE: z.number().nonnegative(),
  sharedTech: share,
  sharedMarketing: share,
  dataSharing: share,
  distributionOverlap: share,
  partnership: z.string().optional(),
  dependency: z.object({ from: id, to: id, note: z.string() }).optional(),
  revenueFlow: z.object({ from: id, to: id, amount: money, note: z.string() }).optional(),
});

const RelType = z.enum(['ownership', 'revenue', 'customer_overlap', 'dependency', 'cross_sell', 'shared_infra', 'partnership', 'shared_tech', 'shared_employees', 'shared_marketing', 'shared_data', 'shared_distribution']);

export const CompanySchema = z
  .object({
    meta: z.object({ id, name: z.string(), currency: z.string().length(3), asOf: z.string(), source: z.string(), description: z.string().optional() }),
    parent: ParentSchema,
    verticals: z.array(VerticalSchema).min(1),
    products: z.array(ProductSchema),
    segments: z.array(SegmentSchema),
    infra: z.array(InfraSchema),
    functions: z.array(FunctionSchema),
    pairs: z.array(PairSchema),
    affinities: z.array(z.object({ a: id, b: id, affinity: share, currentBoth: z.number().nonnegative() })),
    journeys: z.array(z.object({ id, name: z.string(), steps: z.array(id).min(2), customers: z.number(), revenue: money })),
    relations: z.array(z.object({ id, source: id, target: id, type: RelType, strength: share, value: money.optional(), label: z.string().optional(), note: z.string().optional() })),
  })
  .superRefine((c, ctx) => {
    // Referential integrity: every id that is pointed at must exist.
    const ids = new Set<string>(['parent']);
    for (const list of [c.verticals, c.products, c.segments, c.infra, c.functions]) {
      for (const e of list) {
        if (ids.has(e.id)) ctx.addIssue({ code: 'custom', message: `Duplicate id "${e.id}"` });
        ids.add(e.id);
      }
    }
    const verticals = new Set(c.verticals.map((v) => v.id));
    const products = new Set(c.products.map((p) => p.id));
    const need = (ok: boolean, message: string) => ok || ctx.addIssue({ code: 'custom', message });
    c.products.forEach((p) => need(verticals.has(p.vertical), `Product "${p.id}" → unknown vertical "${p.vertical}"`));
    c.segments.forEach((s) => s.purchases.forEach((pu) => need(products.has(pu.product), `Segment "${s.id}" → unknown product "${pu.product}"`)));
    c.infra.forEach((i) => i.dependents.forEach((d) => need(verticals.has(d), `Infra "${i.id}" → unknown vertical "${d}"`)));
    c.pairs.forEach((p) => need(verticals.has(p.a) && verticals.has(p.b), `Pair ${p.a}↔${p.b} references an unknown vertical`));
    c.affinities.forEach((a) => need(products.has(a.a) && products.has(a.b), `Affinity ${a.a}↔${a.b} references an unknown product`));
    c.journeys.forEach((j) => j.steps.forEach((s) => need(ids.has(s), `Journey "${j.id}" → unknown node "${s}"`)));
  });

// Compile-time check that the schema and the TypeScript model stay in sync.
type Parsed = z.infer<typeof CompanySchema>;
const _check: (x: Parsed) => CompanyData = (x) => x;
void _check;

export function parseCompany(input: unknown): { ok: true; data: CompanyData } | { ok: false; errors: string[] } {
  const r = CompanySchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, errors: r.error.issues.slice(0, 25).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}

export const companyJsonSchema = () => z.toJSONSchema(CompanySchema, { unrepresentable: 'any' });
