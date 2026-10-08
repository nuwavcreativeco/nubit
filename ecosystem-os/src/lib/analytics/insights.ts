import type { CompanyData } from '@/lib/domain/types';
import type { CompanyState } from './model';
import type { Synergy } from './synergy';
import type { Bottleneck } from './bottlenecks';
import type { Opportunity } from './opportunities';
import type { OfferPair } from './overlap';
import type { Health } from './health';
import { maxBy, minBy, money, pct, sum } from './format';

export interface Insight {
  id: string;
  tone: 'positive' | 'neutral' | 'warning';
  text: string;
  nodeIds: string[];
}

export interface Analysis {
  state: CompanyState;
  synergies: Synergy[];
  bottlenecks: Bottleneck[];
  opportunities: Opportunity[];
  offerPairs: OfferPair[];
  health: Health;
}

/** Investment thesis statements, derived entirely from the computed state. */
export function investorInsights(data: CompanyData, a: Analysis): Insight[] {
  const { state, synergies, opportunities } = a;
  const out: Insight[] = [];
  const verts = state.active.filter((v) => !v.isNew);
  const rev = state.revenue || 1;

  const top = maxBy(verts, (v) => v.revenue);
  if (top) {
    const share = top.revenue / rev;
    out.push({
      id: 'concentration', tone: share > 0.35 ? 'warning' : 'neutral', nodeIds: [top.id],
      text: share > 0.28
        ? `Revenue is currently concentrated in ${top.v.name} (${pct(share)} of total).`
        : `Revenue is well spread — the largest vertical, ${top.v.name}, is only ${pct(share)} of total.`,
    });
  }

  const fastest = maxBy(verts.filter((v) => v.prevRevenue > 0), (v) => v.growth);
  const launched = verts.filter((v) => v.prevRevenue <= 0 && v.revenue > 0);
  if (launched.length && (!fastest || fastest.growth < 0.05)) {
    const l = maxBy(launched, (v) => v.revenue)!;
    out.push({ id: 'growth', tone: 'warning', nodeIds: [l.id], text: `All growth is coming from ${l.v.name}, new this year (${money(l.revenue)}); the established verticals are flat${fastest ? ` (best: ${fastest.v.name} ${pct(fastest.growth, { sign: true })})` : ''}.` });
  } else if (fastest) out.push({ id: 'growth', tone: 'positive', nodeIds: [fastest.id], text: `${fastest.v.name} has the highest growth rate at ${pct(fastest.growth, { sign: true })} year over year.` });

  const overlap = maxBy(synergies.filter((s) => s.pair.sharedCustomers > 0), (s) => Math.max(s.overlapPctA, s.overlapPctB));
  if (overlap) {
    const aIsSmaller = overlap.overlapPctA >= overlap.overlapPctB;
    const from = aIsSmaller ? overlap.a : overlap.b, to = aIsSmaller ? overlap.b : overlap.a;
    const name = (id: string) => state.verticals.find((v) => v.id === id)!.v.name;
    out.push({ id: 'overlap', tone: 'positive', nodeIds: [from, to], text: `Customers in ${name(from)} have a ${pct(Math.max(overlap.overlapPctA, overlap.overlapPctB))} overlap with ${name(to)}.` });
  }

  const crossSell = sum(synergies.map((s) => s.incrementalRevenue));
  if (crossSell > 0) out.push({ id: 'crosssell', tone: 'positive', nodeIds: synergies.slice(0, 3).flatMap((s) => [s.a, s.b]), text: `Cross-selling could represent an estimated ${money(crossSell)} incremental annual revenue opportunity.` });

  const untapped = maxBy(verts, (v) => v.v.sam - v.revenue);
  if (untapped) out.push({ id: 'untapped', tone: 'positive', nodeIds: [untapped.id], text: `${untapped.v.name} represents the largest untapped market — ${money(untapped.v.sam)} serviceable, only ${pct(untapped.revenue / untapped.v.sam, { digits: 1 })} captured.` });

  out.push({
    id: 'recurring', tone: state.recurringShare >= 0.5 ? 'positive' : 'warning', nodeIds: [],
    text: `${pct(state.recurringShare)} of revenue (${money(state.recurringRevenue)}) is recurring${state.recurringShare >= 0.5 ? ', supporting a premium multiple' : ' — converting one-time services to subscriptions would lift the multiple'}.`,
  });

  const profit = maxBy(verts, (v) => v.ebitda);
  if (profit) out.push({ id: 'profit', tone: 'neutral', nodeIds: [profit.id], text: `${profit.v.name} generates the most EBITDA (${money(profit.ebitda)}, ${pct(profit.ebitdaMargin)} margin).` });

  const weak = minBy(verts, (v) => v.ebitdaMargin);
  if (weak && weak.ebitdaMargin < 0.1) out.push({ id: 'weak', tone: 'warning', nodeIds: [weak.id], text: `${weak.v.name} runs at a ${pct(weak.ebitdaMargin)} EBITDA margin and dilutes consolidated profitability.` });

  const infraHub = maxBy(data.infra, (i) => i.dependents.length);
  if (infraHub && infraHub.dependents.length >= 4) out.push({ id: 'moat', tone: 'positive', nodeIds: [infraHub.id], text: `${infraHub.name} is shared by ${infraHub.dependents.length} verticals — a structural cost advantage stand-alone competitors can't match.` });

  const best = opportunities[0];
  if (best) out.push({ id: 'opp', tone: 'positive', nodeIds: best.nodeIds, text: `Highest-ranked opportunity: ${best.name} (${money(best.revenue || best.profit)} at ${pct(best.confidence)} confidence).` });

  return out;
}

export function strategicMoat(data: CompanyData, a: Analysis): string[] {
  const moat: string[] = [];
  const sharedInfra = data.infra.filter((i) => i.dependents.length >= 3);
  if (sharedInfra.length) moat.push(`${sharedInfra.length} infrastructure systems shared across 3+ verticals`);
  const records = sum(data.infra.map((i) => i.dataRecords ?? 0));
  if (records) moat.push(`Proprietary dataset of ${(records / 1e6).toFixed(1)}M customer & market records`);
  const strong = a.synergies.filter((s) => s.score >= 60);
  if (strong.length) moat.push(`${strong.length} vertical pairs with synergy ≥ 60 — customers are acquired once and served many times`);
  if (a.state.recurringShare > 0.45) moat.push(`${pct(a.state.recurringShare)} recurring revenue base`);
  const flows = data.pairs.filter((p) => p.revenueFlow);
  if (flows.length) moat.push(`${flows.length} internal referral flows worth ${money(sum(flows.map((p) => p.revenueFlow!.amount)))}/yr`);
  return moat;
}

export interface ExecAnswer {
  id: string;
  question: string;
  answer: string;
  detail: string[];
  nodeIds: string[];
  tone: 'positive' | 'neutral' | 'warning';
}

export function executiveAnswers(data: CompanyData, a: Analysis): ExecAnswer[] {
  const { state, synergies, bottlenecks, opportunities, offerPairs } = a;
  const verts = state.active.filter((v) => !v.isNew);
  const name = (id: string) => state.verticals.find((v) => v.id === id)?.v.name ?? id;
  const byEbitda = [...verts].sort((x, y) => y.ebitda - x.ebitda);
  const byGrowth = [...verts].filter((v) => v.prevRevenue > 0).sort((x, y) => y.growth - x.growth);
  const newVerts = verts.filter((v) => v.prevRevenue <= 0 && v.revenue > 0);
  const products = Object.values(state.products).filter((p) => p.active);
  const declining = products.filter((p) => p.growth < 0).sort((x, y) => x.growth - y.growth);
  const lowMargin = [...verts].sort((x, y) => x.ebitdaMargin - y.ebitdaMargin);
  const investScore = (v: (typeof verts)[number]) => v.v.growthPotential * v.v.strategicImportance * v.v.grossMargin * (1 + v.growth);
  const investIn = [...verts].sort((x, y) => investScore(y) - investScore(x));
  const stop = products.filter((p) => p.growth < 0 && p.p.margin < 0.3).concat(products.filter((p) => p.p.margin < 0.25 && p.growth < 0.1)).filter((p, i, arr) => arr.indexOf(p) === i);
  const hubs = [...data.infra].sort((x, y) => y.dependents.length + y.techDebt * 3 - (x.dependents.length + x.techDebt * 3));
  const offers = state.segments.filter((s) => s.s.b2b).sort((x, y) => y.s.crossSellPotential * y.customers - x.s.crossSellPotential * x.customers);

  return [
    {
      id: 'money', question: 'Where are we making money?', tone: 'positive',
      answer: `${byEbitda[0].v.name} and ${byEbitda[1]?.v.name} produce ${pct((byEbitda[0].ebitda + (byEbitda[1]?.ebitda ?? 0)) / Math.max(1, state.ebitda))} of EBITDA.`,
      detail: byEbitda.slice(0, 4).map((v) => `${v.v.name}: ${money(v.ebitda)} EBITDA on ${money(v.revenue)} (${pct(v.ebitdaMargin)})`),
      nodeIds: byEbitda.slice(0, 2).map((v) => v.id),
    },
    {
      id: 'growing', question: 'Where are we growing?', tone: newVerts.length && (!byGrowth[0] || byGrowth[0].growth < 0.05) ? 'warning' : 'positive',
      answer: newVerts.length && (!byGrowth[0] || byGrowth[0].growth < 0.05)
        ? `Only in ${newVerts.map((v) => v.v.name).join(' and ')}, launched this year; established verticals are flat.`
        : byGrowth.length ? `${byGrowth[0].v.name} leads at ${pct(byGrowth[0].growth, { sign: true })}${byGrowth[1] ? `; ${byGrowth[1].v.name} follows at ${pct(byGrowth[1].growth, { sign: true })}` : ''}.` : 'No prior-year data for this view.',
      detail: [...newVerts.map((v) => `${v.v.name}: new — ${money(v.revenue)} this year`), ...byGrowth.slice(0, 4).map((v) => `${v.v.name}: ${pct(v.growth, { sign: true })}`)],
      nodeIds: [...newVerts.map((v) => v.id), ...byGrowth.slice(0, 2).map((v) => v.id)].slice(0, 2),
    },
    {
      id: 'losing', question: 'Where are we losing money?', tone: lowMargin[0].ebitdaMargin < 0.15 || declining.length ? 'warning' : 'positive',
      answer: lowMargin[0].ebitdaMargin < 0.15
        ? `${lowMargin[0].v.name} keeps only ${pct(lowMargin[0].ebitdaMargin)} of revenue as EBITDA${declining[0] ? `, and ${declining[0].p.name} is shrinking ${pct(declining[0].growth)}` : ''}.`
        : `Nowhere outright — every vertical clears a ${pct(lowMargin[0].ebitdaMargin)} EBITDA margin${declining[0] ? `, though ${declining[0].p.name} is shrinking ${pct(declining[0].growth)}` : ''}. Watch for underused capacity instead.`,
      detail: [
        ...lowMargin.slice(0, 2).map((v) => `${v.v.name}: ${pct(v.ebitdaMargin)} EBITDA margin`),
        ...declining.slice(0, 3).map((p) => `${p.p.name}: ${pct(p.growth)} growth, ${pct(p.p.margin)} gross margin`),
      ],
      nodeIds: [lowMargin[0].id, ...declining.slice(0, 2).map((p) => p.id)],
    },
    {
      id: 'invest', question: 'What should we invest in?', tone: 'positive',
      answer: `${investIn[0].v.name} — highest blend of growth potential, strategic importance and margin. Best single move: ${opportunities[0]?.name ?? '—'}.`,
      detail: [
        ...investIn.slice(0, 3).map((v) => `${v.v.name}: potential ${v.v.growthPotential}/10, importance ${v.v.strategicImportance}/10, needs ${money(v.v.requiredInvestment)}`),
        ...opportunities.slice(0, 2).map((o) => `${o.name}: ${money(o.revenue || o.profit)} for ${money(o.investment)}`),
      ],
      nodeIds: [investIn[0].id, ...(opportunities[0]?.nodeIds ?? [])],
    },
    {
      id: 'stop', question: 'What should we stop doing?', tone: 'warning',
      answer: stop.length ? `Wind down or reprice ${stop[0].p.name}: ${pct(stop[0].growth)} growth at ${pct(stop[0].p.margin)} gross margin.` : 'Nothing is both shrinking and low-margin — no obvious cuts.',
      detail: stop.slice(0, 4).map((p) => `${p.p.name} (${name(p.p.vertical)}): ${money(p.revenue)} revenue, ${pct(p.p.margin)} margin, ${pct(p.growth, { sign: true })} growth`),
      nodeIds: stop.slice(0, 3).map((p) => p.id),
    },
    {
      id: 'together', question: 'Which verticals should work together?', tone: 'positive',
      answer: synergies[0] ? `${name(synergies[0].a)} ↔ ${name(synergies[0].b)} (synergy ${synergies[0].score}/100, ${money(synergies[0].incrementalRevenue)} upside).` : '—',
      detail: synergies.slice(0, 4).map((s) => `${name(s.a)} ↔ ${name(s.b)}: ${s.score}/100 — ${s.topDrivers.join(', ').toLowerCase()}`),
      nodeIds: synergies.slice(0, 2).flatMap((s) => [s.a, s.b]),
    },
    {
      id: 'offers', question: 'Which customers should receive additional offers?', tone: 'positive',
      answer: offers[0] ? `${offers[0].s.name}: ${offers[0].customers.toLocaleString()} customers with ${pct(offers[0].s.crossSellPotential)} cross-sell potential.` : '—',
      detail: offerPairs.slice(0, 4).map((o) => `${o.a.name} buyers → offer ${o.b.name}: ~${o.newCustomers} adopters, ${money(o.incrementalRevenue)}`),
      nodeIds: offers.slice(0, 2).map((s) => s.id),
    },
    {
      id: 'dependent', question: 'Where are we operationally dependent?', tone: 'warning',
      answer: `${hubs[0].name} supports ${hubs[0].dependents.length} verticals${hubs[0].techDebt > 0.5 ? ` with ${pct(hubs[0].techDebt)} tech debt` : ''}.`,
      detail: [
        ...hubs.slice(0, 3).map((i) => `${i.name}: ${i.dependents.length} dependents, tech debt ${pct(i.techDebt)}`),
        ...data.functions.filter((f) => f.utilization > 0.85).map((f) => `${f.name}: ${pct(f.utilization)} utilized across ${f.serves.length} verticals`),
      ],
      nodeIds: hubs.slice(0, 2).map((i) => i.id),
    },
    {
      id: 'bottleneck', question: 'What is the biggest bottleneck?', tone: 'warning',
      answer: bottlenecks[0] ? bottlenecks[0].title : 'No bottlenecks detected.',
      detail: bottlenecks.slice(0, 4).map((b) => `${b.title} — ${b.fix}`),
      nodeIds: bottlenecks.slice(0, 1).map((b) => b.nodeId),
    },
    {
      id: 'opportunity', question: 'What is the biggest opportunity?', tone: 'positive',
      answer: opportunities[0] ? `${opportunities[0].name}: ${money(opportunities[0].revenue || opportunities[0].profit)}/yr at ${pct(opportunities[0].confidence)} confidence.` : '—',
      detail: opportunities.slice(0, 4).map((o) => `${o.name}: ${money(o.revenue)} revenue, ${money(o.profit)} profit`),
      nodeIds: opportunities[0]?.nodeIds ?? [],
    },
  ];
}
