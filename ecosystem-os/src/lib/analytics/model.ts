import type { CompanyData, Product, ScenarioParams, Vertical, VerticalPair, Segment } from '@/lib/domain/types';
import { clamp, sum } from './format';

// ─── Baseline ────────────────────────────────────────────────────────────────

export function baselineScenario(data: CompanyData): ScenarioParams {
  const y = data.parent.currentYear;
  const active = data.verticals.filter((v) => isActive(v, y));
  const rev = active.map((v) => seriesValue(v.revenue, y, v.projectedGrowth));
  const totalRev = sum(rev) || 1;
  const retention = sum(active.map((v, i) => v.retention * rev[i])) / totalRev;
  const pairs = activePairs(data, y);
  const eligible = sum(pairs.map((p) => p.eligibleAtoB + p.eligibleBtoA));
  const crossSellRate = eligible ? sum(pairs.map((p) => p.currentCrossSellRate * (p.eligibleAtoB + p.eligibleBtoA))) / eligible : 0;
  return { customerGrowth: 0, pricing: 0, crossSellRate: round(crossSellRate, 3), retention: round(retention, 3), newVertical: 0, costEfficiency: 0, verticalPlans: {} };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

// ─── Time helpers ────────────────────────────────────────────────────────────

export function isActive(e: { launchYear?: number; sunsetYear?: number }, year: number) {
  if (e.launchYear && year < e.launchYear) return false;
  if (e.sunsetYear && year >= e.sunsetYear) return false;
  return true;
}

/** Value of a series in a year: explicit if present, else projected from the last known year. */
export function seriesValue(series: Record<string, number>, year: number, growth: number) {
  if (series[year] !== undefined) return series[year];
  const known = Object.keys(series).map(Number).sort((a, b) => a - b);
  if (!known.length) return 0;
  const before = known.filter((y) => y < year);
  if (!before.length) return 0;
  const last = before[before.length - 1];
  // Growth decays 15%/yr toward a steady state so projections stay credible.
  let v = series[last];
  let g = growth;
  for (let y = last + 1; y <= year; y++) {
    v *= 1 + g;
    g *= 0.85;
  }
  return v;
}

export function activePairs(data: CompanyData, year: number): VerticalPair[] {
  const active = new Set(data.verticals.filter((v) => isActive(v, year)).map((v) => v.id));
  return data.pairs.filter((p) => active.has(p.a) && active.has(p.b));
}

// ─── State ───────────────────────────────────────────────────────────────────

export interface VerticalState {
  id: string;
  v: Vertical;
  active: boolean;
  isNew: boolean;
  baseRevenue: number;
  revenue: number;
  prevRevenue: number;
  growth: number;
  grossProfit: number;
  ebitda: number;
  ebitdaMargin: number;
  customers: number;
  employees: number;
  recurringRevenue: number;
  arpc: number;
  components: { volume: number; price: number; crossSell: number; efficiency: number };
}

export interface ProductState {
  id: string;
  p: Product;
  active: boolean;
  revenue: number;
  baseRevenue: number;
  prevRevenue: number;
  growth: number;
  profit: number;
  customers: number;
}

export interface SegmentState {
  id: string;
  s: Segment;
  revenue: number;
  customers: number;
  verticals: string[];
  share: number;
}

export interface CompanyState {
  year: number;
  isProjected: boolean;
  isPast: boolean;
  scenarioApplied: boolean;
  verticals: VerticalState[];
  active: VerticalState[];
  products: Record<string, ProductState>;
  segments: SegmentState[];
  revenue: number;
  baseRevenue: number;
  prevRevenue: number;
  growth: number;
  grossProfit: number;
  ebitda: number;
  ebitdaMargin: number;
  customers: number;
  employees: number;
  recurringRevenue: number;
  recurringShare: number;
  crossSellRevenue: number;
}

export const NEW_VERTICAL_ID = 'new-vertical';

function newVerticalTemplate(data: CompanyData): Vertical {
  return {
    id: NEW_VERTICAL_ID, name: 'New Vertical', hue: 330, icon: 'PlusCircle',
    description: 'Hypothetical vertical contributed by the scenario.',
    revenue: {}, projectedGrowth: 0.4, grossMargin: 0.55, ebitdaMargin: 0.12, contributionMargin: 0.35,
    customers: 0, employees: 0, recurringShare: 0.5, cac: 2000, ltv: 16000, retention: 0.8,
    tam: 5_000_000_000, sam: 150_000_000, strategicImportance: 6, growthPotential: 7,
    marketingSpend: 0, requiredInvestment: 0, b2b: true,
    ops: { leadsPerMonth: 0, leadsNeeded: 0, utilization: 0.6, keyPersonRisk: 0.5, topCustomerShare: 0.1 },
    risks: ['Execution risk of launching or acquiring a new line'],
  };
}

/**
 * Computes the company in a given year. Scenario assumptions apply from the current
 * year forward (as run-rate changes); past years always show actuals.
 */
export function computeState(data: CompanyData, year: number, scenario: ScenarioParams, baseline: ScenarioParams): CompanyState {
  const cur = data.parent.currentYear;
  const applies = year >= cur;
  const s = applies ? scenario : baseline;

  const priceMult = (1 + s.pricing) * (1 - 0.35 * s.pricing); // 0.35 price elasticity on volume
  const custMult = 1 + s.customerGrowth;
  const retDelta = s.retention - baseline.retention;
  const csRatio = baseline.crossSellRate > 0 ? s.crossSellRate / baseline.crossSellRate : 1;

  const baseRev = (v: Vertical, y: number) => (isActive(v, y) ? seriesValue(v.revenue, y, v.projectedGrowth) : 0);

  // Cross-sell revenue landing in each vertical from changing the cross-sell rate.
  const crossSellDelta: Record<string, number> = {};
  for (const p of activePairs(data, year)) {
    const va = data.verticals.find((v) => v.id === p.a)!;
    const vb = data.verticals.find((v) => v.id === p.b)!;
    const ticket = (v: Vertical) => (baseRev(v, year) / Math.max(1, v.customers)) * 0.35; // starter ticket for a cross-sold customer
    const rate = (cur: number, target: number) => clamp(cur * csRatio, 0, Math.max(target * 1.5, cur));
    const r = rate(p.currentCrossSellRate, p.targetCrossSellRate) - p.currentCrossSellRate;
    crossSellDelta[p.b] = (crossSellDelta[p.b] ?? 0) + p.eligibleAtoB * r * ticket(vb);
    crossSellDelta[p.a] = (crossSellDelta[p.a] ?? 0) + p.eligibleBtoA * r * ticket(va);
  }

  const verticalList = [...data.verticals];
  if (s.newVertical > 0 && applies) verticalList.push(newVerticalTemplate(data));

  // Unit plans compound from their start year (never before the current year).
  const planMult = (id: string) => {
    const p = applies ? s.verticalPlans?.[id] : undefined;
    if (!p || !p.extraGrowth) return 1;
    const from = Math.max(p.startYear, cur);
    // Plan growth fades 15%/yr like base growth: momentum tapers instead of compounding forever.
    let m = 1;
    for (let k = 0; k <= year - from; k++) m *= 1 + p.extraGrowth * Math.pow(0.85, k);
    return m;
  };
  // Prior year under the same scenario, so growth rates stay right when plans compound.
  const prevState = applies && year > cur ? computeState(data, year - 1, scenario, baseline) : null;

  const verticals: VerticalState[] = verticalList.map((v) => {
    const isNew = v.id === NEW_VERTICAL_ID;
    const base = isNew ? s.newVertical * Math.pow(1.4, year - cur) : baseRev(v, year);
    const plan = isNew ? 1 : planMult(v.id);
    const active = base > 0;
    const prevBase = isNew ? (year > cur ? s.newVertical * Math.pow(1.4, year - 1 - cur) : 0) : baseRev(v, year - 1);

    let volume = 0, price = 0, crossSell = 0, efficiency = 0;
    if (applies && active && !isNew) {
      const retMult = 1 + retDelta * (v.recurringShare * 1.6 + (1 - v.recurringShare) * 0.5);
      const afterVolume = base * plan * custMult * retMult;
      volume = afterVolume - base;
      price = afterVolume * (priceMult - 1);
      crossSell = crossSellDelta[v.id] ?? 0;
    }
    const revenue = Math.max(0, base + volume + price + crossSell);
    const opex = base * Math.max(0, v.grossMargin - v.ebitdaMargin);
    efficiency = applies ? opex * s.costEfficiency : 0;
    const ebitda = base * v.ebitdaMargin + volume * v.contributionMargin + price * 0.9 + crossSell * v.grossMargin * 0.85 + efficiency;
    const growthFactor = base > 0 && v.revenue[cur] ? base / baseRev(v, cur) : 1;
    const customers = isNew
      ? Math.round(revenue / 15000)
      : Math.round(v.customers * Math.pow(Math.max(growthFactor, 0.01), 0.8) * (applies ? custMult * (1 + retDelta * 0.8) * Math.pow(plan, 0.85) : 1));

    // Previous-year revenue: actuals for the current year, scenario-adjusted otherwise.
    const prevRevenue = prevState ? prevState.verticals.find((x) => x.id === v.id)?.revenue ?? prevBase : prevBase;

    return {
      id: v.id, v, active, isNew,
      baseRevenue: base,
      revenue,
      prevRevenue,
      growth: prevRevenue > 0 ? revenue / prevRevenue - 1 : 0,
      grossProfit: revenue * v.grossMargin,
      ebitda,
      ebitdaMargin: revenue ? ebitda / revenue : 0,
      customers: active ? customers : 0,
      employees: active ? Math.round(v.employees * Math.pow(Math.max(growthFactor, 0.01), 0.6) * (revenue / Math.max(base, 1)) ** 0.5) : 0,
      recurringRevenue: revenue * v.recurringShare,
      arpc: customers ? revenue / customers : 0,
      components: { volume, price, crossSell, efficiency },
    };
  });

  const active = verticals.filter((v) => v.active);
  const vMap = Object.fromEntries(verticals.map((v) => [v.id, v]));

  // Products: own growth for projections, then normalized to the vertical total.
  const products: Record<string, ProductState> = {};
  for (const v of data.verticals) {
    const list = data.products.filter((p) => p.vertical === v.id);
    const raw = (y: number) => list.map((p) => (isActive(p, y) ? seriesValue(p.revenue, y, p.growth) : 0));
    const rawNow = raw(year);
    const rawPrev = raw(year - 1);
    const vs = vMap[v.id];
    const totalNow = sum(rawNow) || 1;
    const totalPrev = sum(rawPrev) || 1;
    list.forEach((p, i) => {
      const revenue = vs?.active ? (rawNow[i] / totalNow) * vs.revenue : 0;
      const baseRevenue = vs?.active ? (rawNow[i] / totalNow) * vs.baseRevenue : 0;
      const prevRevenue = vs ? (rawPrev[i] / totalPrev) * vs.prevRevenue : 0;
      const growthFactor = p.revenue[cur] ? revenue / p.revenue[cur] : revenue / Math.max(1, rawNow[i]);
      products[p.id] = {
        id: p.id, p,
        active: revenue > 0,
        revenue, baseRevenue, prevRevenue,
        growth: prevRevenue > 0 ? revenue / prevRevenue - 1 : 0,
        profit: revenue * p.margin * (v.ebitdaMargin / Math.max(v.grossMargin, 0.01)),
        customers: Math.round(p.customers * Math.pow(Math.max(growthFactor, 0.01), 0.8)),
      };
    });
  }

  const segments: SegmentState[] = data.segments.map((s) => {
    const revenue = sum(s.purchases.map((pu) => {
      const ps = products[pu.product];
      if (!ps || !ps.active) return 0;
      const ref = ps.p.revenue[cur] ?? ps.revenue;
      return pu.revenue * (ref ? ps.revenue / ref : 1);
    }));
    const verts = [...new Set(s.purchases.map((pu) => products[pu.product]).filter((p) => p?.active).map((p) => p!.p.vertical))];
    const base = sum(s.purchases.map((p) => p.revenue)) || 1;
    return { id: s.id, s, revenue, customers: Math.round(s.customers * (revenue / base) ** 0.8), verticals: verts, share: 0 };
  });
  const segTotal = sum(segments.map((s) => s.revenue)) || 1;
  segments.forEach((s) => (s.share = s.revenue / segTotal));

  const revenue = sum(active.map((v) => v.revenue));
  const prevRevenue = sum(verticals.map((v) => v.prevRevenue));
  const ebitda = sum(active.map((v) => v.ebitda));
  const recurringRevenue = sum(active.map((v) => v.recurringRevenue));
  const crossSellRevenue = sum(activePairs(data, year).map((p) => p.crossSellRevenue)) + sum(active.map((v) => v.components.crossSell));

  return {
    year,
    isProjected: year > cur,
    isPast: year < cur,
    scenarioApplied: applies,
    verticals,
    active,
    products,
    segments,
    revenue,
    baseRevenue: sum(active.map((v) => v.baseRevenue)),
    prevRevenue,
    growth: prevRevenue ? revenue / prevRevenue - 1 : 0,
    grossProfit: sum(active.map((v) => v.grossProfit)),
    ebitda,
    ebitdaMargin: revenue ? ebitda / revenue : 0,
    customers: sum(active.map((v) => v.customers)),
    employees: sum(active.map((v) => v.employees)) + sum(data.functions.map((f) => f.fte)),
    recurringRevenue,
    recurringShare: revenue ? recurringRevenue / revenue : 0,
    crossSellRevenue,
  };
}

/** EV/EBITDA multiple driven by growth, recurring revenue and health. */
export function valuation(state: CompanyState, healthScore: number) {
  // Growth is capped so a one-off step change (e.g. a scenario) isn't capitalised as permanent growth.
  const base = clamp(5 + Math.min(state.growth, 0.35) * 18 + state.recurringShare * 4 + (healthScore - 50) / 25, 4, 22);
  // Size discount: owner-run businesses trade far below scaled companies (≈0.25× under $100K EBITDA,
  // ≈0.67× at $1M, full multiple from ~$10M).
  const sizeFactor = clamp((Math.log10(Math.max(state.ebitda, 1)) - 4) / 3, 0.25, 1);
  const multiple = Math.max(1.5, base * sizeFactor);
  const ev = Math.max(state.ebitda, 0) * multiple;
  return { multiple, ev, revenueMultiple: state.revenue ? ev / state.revenue : 0 };
}
