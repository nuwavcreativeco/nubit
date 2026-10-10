import type { CompanyData, VerticalPair } from '@/lib/domain/types';
import { activePairs, type CompanyState } from './model';
import { clamp, sum } from './format';

export const SYNERGY_FACTORS = [
  { key: 'customerOverlap', label: 'Customer overlap', weight: 0.16 },
  { key: 'sharedInfra', label: 'Shared infrastructure', weight: 0.1 },
  { key: 'sharedEmployees', label: 'Shared employees', weight: 0.08 },
  { key: 'sharedTech', label: 'Shared technology', weight: 0.1 },
  { key: 'sharedMarketing', label: 'Shared marketing', weight: 0.1 },
  { key: 'crossSelling', label: 'Cross-selling', weight: 0.12 },
  { key: 'revenuePotential', label: 'Revenue potential', weight: 0.14 },
  { key: 'operationalEfficiency', label: 'Operational efficiencies', weight: 0.08 },
  { key: 'dataSharing', label: 'Data sharing', weight: 0.06 },
  { key: 'distribution', label: 'Distribution overlap', weight: 0.06 },
] as const;

export type SynergyFactorKey = (typeof SYNERGY_FACTORS)[number]['key'];

export interface Synergy {
  id: string;
  a: string;
  b: string;
  pair: VerticalPair;
  score: number;
  factors: Record<SynergyFactorKey, number>;
  overlapPctA: number; // share of A's customers also buying from B
  overlapPctB: number;
  incrementalRevenue: number;
  costSavings: number;
  untappedCustomers: number;
  topDrivers: string[];
}

/** Fallback when the company has no shared-team cost data. */
const AVG_FTE_COST = 85_000;

/** What one shared FTE actually costs this company, from its shared teams (an unpaid founder costs $0). */
function costPerFte(data: CompanyData) {
  const fte = sum(data.functions.map((f) => f.fte));
  return fte > 0 ? sum(data.functions.map((f) => f.annualCost)) / fte : AVG_FTE_COST;
}

export function computeSynergies(data: CompanyData, state: CompanyState): Synergy[] {
  const vs = Object.fromEntries(state.verticals.map((v) => [v.id, v]));
  const fteCost = costPerFte(data);
  const infraCost = Object.fromEntries(data.infra.map((i) => [i.id, i.annualCost]));
  const pairs = activePairs(data, state.year);

  const raw = pairs.map((p) => {
    const A = vs[p.a], B = vs[p.b];
    const arpc = (v: typeof A) => (v.customers ? v.revenue / v.customers : 0);
    const untappedAB = p.eligibleAtoB * Math.max(0, p.targetCrossSellRate - p.currentCrossSellRate);
    const untappedBA = p.eligibleBtoA * Math.max(0, p.targetCrossSellRate - p.currentCrossSellRate);
    // Cross-sold customers typically start on ~35% of a full customer's spend.
    const flowBonus = p.revenueFlow ? p.revenueFlow.amount * 0.3 : 0;
    const incrementalRevenue = untappedAB * arpc(B) * 0.35 + untappedBA * arpc(A) * 0.35 + flowBonus;
    const sharedInfraCost = sum(p.sharedInfra.map((id) => infraCost[id] ?? 0));
    const costSavings =
      sharedInfraCost * 0.2 +
      p.sharedEmployeesFTE * fteCost * 0.25 +
      p.sharedMarketing * Math.min(A.v.marketingSpend, B.v.marketingSpend) * 0.2;
    return { p, A, B, incrementalRevenue, costSavings, untapped: untappedAB + untappedBA };
  });

  const maxRev = Math.max(1, ...raw.map((r) => r.incrementalRevenue));
  const maxSave = Math.max(1, ...raw.map((r) => r.costSavings));

  return raw
    .map(({ p, A, B, incrementalRevenue, costSavings, untapped }) => {
      const smaller = Math.max(1, Math.min(A.customers, B.customers));
      const factors: Record<SynergyFactorKey, number> = {
        customerOverlap: clamp((p.sharedCustomers / smaller) * 2),
        sharedInfra: clamp(p.sharedInfra.length / 3),
        sharedEmployees: clamp(p.sharedEmployeesFTE / 5),
        sharedTech: p.sharedTech,
        sharedMarketing: p.sharedMarketing,
        crossSelling: clamp(Math.max(p.currentCrossSellRate, p.targetCrossSellRate * 0.6) / 0.3 + (p.revenueFlow ? 0.3 : 0)),
        revenuePotential: Math.sqrt(incrementalRevenue / maxRev),
        operationalEfficiency: Math.sqrt(costSavings / maxSave),
        dataSharing: p.dataSharing,
        distribution: p.distributionOverlap,
      };
      const score = Math.round(100 * sum(SYNERGY_FACTORS.map((f) => factors[f.key] * f.weight)));
      const topDrivers = [...SYNERGY_FACTORS]
        .sort((x, y) => factors[y.key] * y.weight - factors[x.key] * x.weight)
        .slice(0, 3)
        .map((f) => f.label);
      return {
        id: `${p.a}__${p.b}`, a: p.a, b: p.b, pair: p, score, factors,
        overlapPctA: A.customers ? p.sharedCustomers / A.customers : 0,
        overlapPctB: B.customers ? p.sharedCustomers / B.customers : 0,
        incrementalRevenue, costSavings, untappedCustomers: Math.round(untapped), topDrivers,
      };
    })
    .sort((x, y) => y.score - x.score);
}
