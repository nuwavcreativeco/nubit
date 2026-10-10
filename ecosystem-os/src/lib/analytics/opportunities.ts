import type { CompanyData } from '@/lib/domain/types';
import type { CompanyState } from './model';
import type { Synergy } from './synergy';
import type { Bundle } from './overlap';
import { clamp, money, pct } from './format';

export type OpportunityType =
  | 'cross_sell' | 'upsell' | 'bundle' | 'geographic' | 'customer_expansion'
  | 'subscription' | 'infra_monetization' | 'data_monetization' | 'vertical_integration' | 'internal_leverage';

export const OPPORTUNITY_LABEL: Record<OpportunityType, string> = {
  cross_sell: 'Cross-sell',
  upsell: 'Upsell',
  bundle: 'Bundle',
  geographic: 'Geographic expansion',
  customer_expansion: 'Customer expansion',
  subscription: 'Subscription',
  infra_monetization: 'Infrastructure monetization',
  data_monetization: 'Data monetization',
  vertical_integration: 'Vertical integration',
  internal_leverage: 'Internal leverage',
};

export interface Opportunity {
  id: string;
  type: OpportunityType;
  name: string;
  description: string;
  revenue: number;
  profit: number;
  confidence: number; // 0-1
  difficulty: number; // 0-1
  investment: number;
  months: number;
  impact: number; // 0-10 strategic impact
  dependencies: string[];
  nodeIds: string[];
  score: number;
}

const difficultyLabel = (d: number) => (d < 0.35 ? 'Low' : d < 0.6 ? 'Medium' : 'High');
export { difficultyLabel };

export function findOpportunities(data: CompanyData, state: CompanyState, synergies: Synergy[], bundles: Bundle[]): Opportunity[] {
  const out: Omit<Opportunity, 'score'>[] = [];
  // Materiality thresholds scale with the company, so a $100K business and a $100M group both see their real options.
  const material = (share: number, floor: number) => Math.max(floor, state.revenue * share);
  // Default launch costs are sized for a ~$20M group; a smaller company runs the same play leaner.
  const sizeK = Math.min(1, Math.sqrt(state.revenue / 20_000_000));
  const cost = (usd: number) => Math.max(500, Math.round((usd * sizeK) / 100) * 100);
  const vs = Object.fromEntries(state.verticals.map((v) => [v.id, v]));
  const infraName = Object.fromEntries(data.infra.map((i) => [i.id, i.name]));
  const vName = (id: string) => vs[id]?.v.name ?? id;

  for (const s of synergies.filter((s) => s.incrementalRevenue > material(0.002, 500)).slice(0, 6)) {
    const A = vs[s.a], B = vs[s.b];
    const gm = (A.v.grossMargin + B.v.grossMargin) / 2;
    out.push({
      id: `cs-${s.id}`, type: 'cross_sell',
      name: `Cross-sell ${A.v.name} ↔ ${B.v.name}`,
      description: `${s.untappedCustomers.toLocaleString()} existing customers could adopt the sister vertical; raising cross-sell from ${pct(s.pair.currentCrossSellRate)} to ${pct(s.pair.targetCrossSellRate)}.`,
      revenue: s.incrementalRevenue, profit: s.incrementalRevenue * gm * 0.8,
      confidence: clamp(0.45 + s.score / 250), difficulty: clamp(0.25 + (1 - s.pair.sharedTech) * 0.35),
      investment: cost(40_000) + s.untappedCustomers * 40, months: 4, impact: Math.round(s.score / 10),
      dependencies: s.pair.sharedInfra.map((id) => infraName[id]).filter(Boolean),
      nodeIds: [s.a, s.b],
    });
  }

  for (const p of data.products) {
    const ps = state.products[p.id];
    if (!p.upsell || !ps?.active) continue;
    const revenue = ps.customers * p.upsell.rate * p.upsell.priceUplift;
    out.push({
      id: `up-${p.id}`, type: 'upsell',
      name: `Upsell ${p.name} → ${p.upsell.to}`,
      description: `${pct(p.upsell.rate)} of ${ps.customers.toLocaleString()} customers moving up a tier at +${money(p.upsell.priceUplift)}/yr.`,
      revenue, profit: revenue * Math.min(0.95, p.margin + 0.1), confidence: 0.65, difficulty: 0.3,
      investment: cost(25_000), months: 3, impact: 5, dependencies: [vName(p.vertical) + ' delivery capacity'], nodeIds: [p.id],
    });
  }

  for (const b of bundles.slice(0, 4)) {
    out.push({
      id: `bd-${b.id}`, type: 'bundle', name: `Launch “${b.name}”`,
      description: `Package ${b.members.map((m) => m.name).join(' + ')} at ${money(b.price)}/yr (15% bundle discount).`,
      revenue: b.incrementalRevenue, profit: b.incrementalMargin,
      confidence: clamp(b.avgAffinity * 0.8), difficulty: clamp(0.3 + b.verticals.length * 0.1),
      investment: cost(50_000 + b.members.length * 10_000), months: 4, impact: Math.round(b.strategicValue / 10),
      dependencies: b.verticals.map(vName), nodeIds: b.members.map((m) => m.id),
    });
  }

  for (const v of state.active) {
    for (const m of v.v.expansion ?? []) {
      const revenue = v.revenue * m.sizeRatio * m.capture;
      out.push({
        id: `geo-${v.id}-${m.market}`, type: 'geographic', name: `Take ${v.v.name} to ${m.market}`,
        description: `Replicate the ${v.v.name} model in a market ${pct(m.sizeRatio)} the size of today's, capturing ${pct(m.capture)} of current performance.`,
        revenue, profit: revenue * v.v.ebitdaMargin * 0.8, confidence: 0.45, difficulty: 0.6,
        investment: m.investment, months: m.months, impact: 6, dependencies: ['Local hiring', 'Brand awareness'], nodeIds: [v.id],
      });
    }
  }

  // Segments that only buy from a few verticals but sit next to a vertical they don't buy from yet.
  for (const seg of state.segments) {
    if (!seg.s.b2b || seg.s.crossSellPotential < 0.4) continue;
    const candidates = state.active.filter((v) => !seg.verticals.includes(v.id) && v.v.b2b && !v.isNew);
    const best = candidates
      .map((v) => ({ v, value: seg.customers * seg.s.crossSellPotential * 0.06 * v.arpc * 0.35 }))
      .sort((a, b) => b.value - a.value)[0];
    if (!best || best.value < material(0.0015, 300)) continue;
    out.push({
      id: `cx-${seg.id}-${best.v.id}`, type: 'customer_expansion',
      name: `Introduce ${best.v.v.name} to ${seg.s.name}`,
      description: `${seg.s.name} buy from ${seg.verticals.length} vertical${seg.verticals.length === 1 ? '' : 's'} today but never from ${best.v.v.name}.`,
      revenue: best.value, profit: best.value * best.v.v.grossMargin * 0.7,
      confidence: 0.5, difficulty: 0.4, investment: cost(30_000), months: 5, impact: 5,
      dependencies: ['Shared CRM view of the customer'], nodeIds: [seg.id, best.v.id],
    });
  }

  for (const p of data.products) {
    const ps = state.products[p.id];
    if (p.recurring || !ps?.active || p.repeatRate < 0.3 || ps.customers < Math.min(40, Math.max(10, state.customers * 0.05))) continue;
    const revenue = ps.revenue * p.repeatRate * 0.25;
    out.push({
      id: `sub-${p.id}`, type: 'subscription', name: `Turn ${p.name} into a subscription`,
      description: `${pct(p.repeatRate)} of buyers already repurchase; a membership locks that in and lifts retained spend ~25%.`,
      revenue, profit: revenue * p.margin, confidence: 0.55, difficulty: 0.35,
      investment: cost(40_000), months: 4, impact: 6, dependencies: ['Payments & Billing'], nodeIds: [p.id],
    });
  }

  for (const i of data.infra) {
    const active = i.dependents.some((d) => vs[d]?.active);
    if (i.externalizable && active) {
      const x = i.externalizable;
      const revenue = x.customers * x.price;
      out.push({
        id: `im-${i.id}`, type: 'infra_monetization', name: `Sell ${i.name} externally as “${x.offer}”`,
        description: `Internal capability already paid for; ${x.customers} external customers at ${money(x.price)}/yr.`,
        revenue, profit: revenue * 0.6, confidence: x.confidence, difficulty: 0.55,
        investment: x.investment, months: 6, impact: 7, dependencies: [i.name], nodeIds: [i.id],
      });
    }
    if (i.dataRecords && active) {
      const revenue = (i.dataRecords / 1000) * 45;
      out.push({
        id: `dm-${i.id}`, type: 'data_monetization', name: 'Local market benchmark product',
        description: `${(i.dataRecords / 1e6).toFixed(1)}M anonymized records across verticals could power paid benchmarks and intelligence.`,
        revenue, profit: revenue * 0.75, confidence: 0.4, difficulty: 0.7,
        investment: cost(150_000), months: 9, impact: 7, dependencies: [i.name, 'Privacy review'], nodeIds: [i.id],
      });
    }
  }

  for (const v of state.active) {
    const sc = v.v.supplyChain;
    if (!sc) continue;
    const savings = sc.externalSpend * sc.inHouseSavingsRate;
    out.push({
      id: `vi-${v.id}`, type: 'vertical_integration', name: `Bring ${sc.name} in-house`,
      description: `${money(sc.externalSpend)} of annual supplier spend could be internalized at ~${pct(sc.inHouseSavingsRate)} savings.`,
      revenue: 0, profit: savings, confidence: 0.5, difficulty: 0.75,
      investment: sc.investment, months: 12, impact: 5, dependencies: ['Working capital', 'Operations hire'], nodeIds: [v.id],
    });
  }

  // A vertical that sells marketing/acquisition can generate demand for a sibling that is short on leads
  // and gets no marketing support from it today.
  const marketers = state.active.filter((v) => !v.isNew && data.products.some((p) => p.vertical === v.id && state.products[p.id]?.active && p.capabilities.includes('acquisition')));
  for (const m of marketers) {
    for (const t of state.active) {
      if (t.id === m.id || t.isNew || t.v.ops.leadsPerMonth >= t.v.ops.leadsNeeded) continue;
      const pair = data.pairs.find((p) => (p.a === m.id && p.b === t.id) || (p.a === t.id && p.b === m.id));
      if (pair && pair.sharedMarketing >= 0.5) continue; // already supported
      const gap = t.v.ops.leadsNeeded / Math.max(1, t.v.ops.leadsPerMonth) - 1;
      const revenue = t.revenue * Math.min(gap, 1.5) * 0.6;
      if (revenue < material(0.002, 300)) continue;
      out.push({
        id: `il-${m.id}-${t.id}`, type: 'internal_leverage', name: `Have ${m.v.name} run marketing for ${t.v.name}`,
        description: `${t.v.name} gets ${t.v.ops.leadsPerMonth} leads/mo against ${t.v.ops.leadsNeeded} needed, while ${m.v.name} sells exactly this service to outside clients.`,
        revenue, profit: revenue * t.v.contributionMargin, confidence: 0.55, difficulty: 0.25,
        investment: Math.max(500, t.v.ops.leadsNeeded * t.v.cac * 0.5), months: 2, impact: 5,
        dependencies: [`${m.v.name} capacity`], nodeIds: [m.id, t.id],
      });
    }
  }

  return out
    .map((o) => ({ ...o, score: ((o.profit + o.revenue * 0.3) * o.confidence * (0.5 + o.impact / 10)) / Math.sqrt(o.investment + cost(25_000)) }))
    .sort((a, b) => b.score - a.score);
}
