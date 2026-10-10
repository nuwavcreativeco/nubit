import type { CompanyData, ScenarioParams } from '@/lib/domain/types';
import { analyze } from './index';
import { baselineScenario, computeState } from './model';
import { clamp, sum } from './format';

/** Year-by-year projection under a scenario (actuals for past years). */
export function projections(data: CompanyData, scenario: ScenarioParams, baseline: ScenarioParams) {
  return data.parent.years.map((year) => {
    const a = analyze(data, year, scenario, baseline);
    const s = a.state;
    // The current year only counts as projected if the scenario actually changes it.
    const changed = year === data.parent.currentYear && Math.abs(s.revenue - computeState(data, year, baseline, baseline).revenue) > 1;
    return {
      year,
      kind: year < data.parent.currentYear ? 'actual' : year === data.parent.currentYear ? (changed ? 'projected' : 'actual') : 'projected',
      revenue: s.revenue,
      growth: s.growth,
      grossProfit: s.grossProfit,
      ebitda: s.ebitda,
      ebitdaMargin: s.ebitdaMargin,
      customers: s.customers,
      employees: s.employees,
      recurringShare: s.recurringShare,
      health: a.health.score,
      ev: a.valuation.ev,
      byVertical: Object.fromEntries(s.active.map((v) => [v.v.name, v.revenue])),
    };
  });
}

/** First year a metric crosses a threshold under a scenario (e.g. seven-figure cash flow). */
export function milestone(data: CompanyData, scenario: ScenarioParams, baseline: ScenarioParams, metric: 'revenue' | 'ebitda', threshold: number) {
  return projections(data, scenario, baseline).find((p) => p[metric] >= threshold)?.year ?? null;
}

/** Removes a vertical (and everything that only exists through it) and diffs the result. */
export function removeVertical(data: CompanyData, verticalId: string) {
  const v = data.verticals.find((x) => x.id === verticalId);
  if (!v) return null;
  const productIds = new Set(data.products.filter((p) => p.vertical === verticalId).map((p) => p.id));
  const without: CompanyData = {
    ...data,
    verticals: data.verticals.filter((x) => x.id !== verticalId),
    products: data.products.filter((p) => !productIds.has(p.id)),
    segments: data.segments.map((s) => ({ ...s, purchases: s.purchases.filter((pu) => !productIds.has(pu.product)) })).filter((s) => s.purchases.length),
    infra: data.infra.map((i) => ({ ...i, dependents: i.dependents.filter((d) => d !== verticalId) })),
    functions: data.functions.map((f) => ({ ...f, serves: f.serves.filter((d) => d !== verticalId) })),
    pairs: data.pairs.filter((p) => p.a !== verticalId && p.b !== verticalId),
    affinities: data.affinities.filter((a) => !productIds.has(a.a) && !productIds.has(a.b)),
    journeys: data.journeys.filter((j) => !j.steps.some((s) => s === verticalId || productIds.has(s))),
    relations: data.relations.filter((r) => !productIds.has(r.source) && !productIds.has(r.target)),
  };
  const year = data.parent.currentYear;
  const b0 = baselineScenario(data), b1 = baselineScenario(without);
  const before = analyze(data, year, b0, b0);
  const after = analyze(without, year, b1, b1);
  const lostPairs = before.synergies.filter((s) => s.a === verticalId || s.b === verticalId);
  const orphanedInfra = data.infra.filter((i) => i.dependents.includes(verticalId)).map((i) => ({
    name: i.name, remainingDependents: i.dependents.filter((d) => d !== verticalId).length, annualCost: i.annualCost,
  }));
  return {
    vertical: v.name,
    before: { revenue: before.state.revenue, ebitda: before.state.ebitda, customers: before.state.customers, health: before.health.score, ev: before.valuation.ev },
    after: { revenue: after.state.revenue, ebitda: after.state.ebitda, customers: after.state.customers, health: after.health.score, ev: after.valuation.ev },
    lostSynergyRevenue: sum(lostPairs.map((s) => s.incrementalRevenue)),
    lostCostSavings: sum(lostPairs.map((s) => s.costSavings)),
    lostReferralFlows: data.pairs.filter((p) => p.revenueFlow && (p.a === verticalId || p.b === verticalId)).map((p) => ({ note: p.revenueFlow!.note, amount: p.revenueFlow!.amount })),
    orphanedInfra,
    note: 'Shared infrastructure costs stay with the group after removal unless explicitly cut; remaining verticals absorb them.',
  };
}

/** Where should the next dollar go? Ranks verticals by LTV-based value created per dollar, capped by delivery capacity. */
export function investmentAllocation(data: CompanyData, amount: number) {
  const year = data.parent.currentYear;
  const b = baselineScenario(data);
  const state = computeState(data, year, b, b);
  return state.active
    .filter((v) => !v.isNew)
    .map((v) => {
      const util = v.v.ops.utilization;
      // Teams (or buildings) past ~85% utilization can't absorb new demand without hiring or capex.
      const capacityFactor = util <= 0.85 ? 1 : clamp(1 - (util - 0.85) / 0.12, 0.1, 1);
      const bought = (amount * 0.7) / Math.max(1, v.v.cac);
      // Customers the current team can take on before hitting ~85% utilization (at least ~5% via overtime
      // and slack); beyond that needs hiring.
      const headroom = util > 0 ? v.customers * Math.max(0.05, 0.85 / util - 1) : Infinity;
      const served = Math.min(bought * capacityFactor, headroom);
      const capped = served < bought * capacityFactor;
      const firstYearRevenue = served * v.arpc * 0.6;
      const valueCreated = served * v.v.ltv * v.v.grossMargin;
      return {
        vertical: v.id, name: v.v.name, newCustomers: Math.round(served), firstYearRevenue, valueCreated,
        roi: valueCreated / amount, capacityFactor, ltvCac: v.v.ltv / Math.max(1, v.v.cac),
        constraint: capped
          ? `The spend would win ~${Math.round(bought)} customers, but at ${(util * 100).toFixed(0)}% utilization the current team can serve only ~${Math.max(1, Math.round(headroom))} more without hiring`
          : capacityFactor < 1 ? `Capacity at ${(util * 100).toFixed(0)}% — only ${(capacityFactor * 100).toFixed(0)}% of new demand can be served without hiring or capex` : null,
      };
    })
    .sort((x, y) => y.valueCreated - x.valueCreated);
}
