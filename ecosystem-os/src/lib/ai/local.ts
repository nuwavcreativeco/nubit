import type { AnalystEvent } from './analyst';
import { runTool, type ToolContext } from './tools';
import { computeState } from '@/lib/analytics/model';
import { SYNERGY_FACTORS } from '@/lib/analytics/synergy';

/**
 * Deterministic analyst used when no Anthropic credentials are configured. It routes the question
 * to the same engine tools by keyword and renders a templated answer — no language model involved.
 */
const $ = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(0)}K` : `${s}$${a.toFixed(0)}`;
};
const p = (v: number) => `${(v * 100).toFixed(0)}%`;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function* runLocalAnalyst(question: string, ctx: ToolContext): Generator<AnalystEvent> {
  const q = question.toLowerCase();
  const call = function* (name: string, input: unknown = {}): Generator<AnalystEvent, Json> {
    yield { type: 'tool', name, input };
    const res = runTool(name, input, ctx);
    yield { type: 'tool_result', name, ok: res.ok };
    return (res.ok ? res.result : { error: res.error }) as Json;
  };
  const say = (text: string): AnalystEvent => ({ type: 'text', delta: text });
  const vertical = ctx.data.verticals.find((v) => q.includes(v.name.toLowerCase()) || q.includes(v.id));
  const pctMatch = q.match(/(-?\d+(?:\.\d+)?)\s*%/);
  const amountMatch = q.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|million|thousand)?/i);
  const amount = amountMatch ? Number(amountMatch[1]) * (/m/i.test(amountMatch[2] ?? '') ? 1e6 : /k|thousand/i.test(amountMatch[2] ?? '') ? 1e3 : 1) : 0;

  if (/(remove|without|drop|divest|shut|sell off|close)/.test(q) && vertical) {
    const r = (yield* call('remove_vertical', { vertical_id: vertical.id })).ESTIMATED;
    yield say(`Removing [[node:${vertical.id}|${r.vertical}]] would take revenue from ${$(r.before.revenue)} [ACTUAL] to ${$(r.after.revenue)} [ESTIMATED] and EBITDA from ${$(r.before.ebitda)} [ACTUAL] to ${$(r.after.ebitda)} [ESTIMATED].\n\n`);
    yield say(`- Health score: ${r.before.health} → ${r.after.health} [ESTIMATED]\n- Enterprise value: ${$(r.before.ev)} → ${$(r.after.ev)} [ESTIMATED]\n- Synergy revenue forgone: ${$(r.lostSynergyRevenue)} [ESTIMATED]; cost savings forgone: ${$(r.lostCostSavings)} [ESTIMATED]\n`);
    for (const f of r.lostReferralFlows) yield say(`- Lost referral flow: ${f.note} (${$(f.amount)}/yr) [ACTUAL]\n`);
    yield say(`\n${r.note}`);
  } else if (/(what (happens|if)|increase|decrease|raise|lower|grow).*(customer|price|pricing|retention|cross)/.test(q) || (/scenario/.test(q) && pctMatch)) {
    const val = pctMatch ? Number(pctMatch[1]) / 100 : 0.2;
    const key = /price|pricing/.test(q) ? 'pricing' : /retention/.test(q) ? 'retention' : /cross/.test(q) ? 'crossSellRate' : 'customerGrowth';
    const input = { [key]: key === 'retention' || key === 'crossSellRate' ? val : val };
    const r = yield* call('run_scenario', input);
    const b = r.ACTUAL_baseline_current_year, s = r.PROJECTED_scenario_current_year_run_rate;
    yield say(`With ${key === 'customerGrowth' ? 'customer growth' : key} set to ${p(val)} [USER INPUT], run-rate revenue moves from ${$(b.revenue)} [ACTUAL] to ${$(s.revenue)} [PROJECTED] and EBITDA from ${$(b.ebitda)} [ACTUAL] to ${$(s.ebitda)} [PROJECTED].\n\n`);
    yield say(`- Customers: ${b.customers.toLocaleString()} → ${s.customers.toLocaleString()} [PROJECTED]\n- EBITDA margin: ${p(b.ebitda_margin)} → ${p(s.ebitda_margin)} [PROJECTED]\n- Enterprise value: ${$(b.enterprise_value)} → ${$(s.enterprise_value)} [ESTIMATED]\n`);
    const last = r.PROJECTED_by_year[r.PROJECTED_by_year.length - 1];
    yield say(`- ${last.year} revenue under this scenario: ${$(last.revenue)} [PROJECTED]\n\nAssumption: incremental volume earns each vertical's contribution margin; price increases lose 35% of their volume effect to elasticity.`);
  } else if (/invest|allocate|put .* into|capital/.test(q) || (amount >= 1_000 && /where|which/.test(q))) {
    // No amount given: default to a quarter of this year's revenue, so the answer fits the company's size.
    const revenue = computeState(ctx.data, ctx.year, ctx.scenario, ctx.baseline).revenue;
    const amt = amount >= 1_000 ? amount : Math.max(5_000, Math.round((revenue * 0.25) / 5_000) * 5_000);
    const r = (yield* call('allocate_investment', { amount: amt })).ESTIMATED;
    const [top, second] = r.ranking;
    yield say(`An extra ${$(amt)} [USER INPUT] creates the most value in [[node:${top.vertical}|${top.name}]]: about ${$(top.valueCreated)} of lifetime gross profit [ESTIMATED] and ${$(top.firstYearRevenue)} first-year revenue [ESTIMATED].\n\n`);
    for (const x of r.ranking.slice(0, 4)) yield say(`- ${x.name}: ${$(x.valueCreated)} value, ${x.ltvCac.toFixed(1)}× LTV:CAC [ESTIMATED]${x.constraint ? ` — ${x.constraint}` : ''}\n`);
    yield say(`\n${second ? `Runner-up is ${second.name}. ` : ''}Method: ${r.method}`);
  } else if (/acqui|buy a|purchase/.test(q)) {
    const r = yield* call('list_saved_acquisitions');
    if (r.note) yield say(r.note);
    else {
      const ranked = [...r.targets].sort((x: Json, y: Json) => y.ESTIMATED.strategic_fit - x.ESTIMATED.strategic_fit);
      const t = ranked[0];
      yield say(`**${t.USER_INPUT.name}** is the strongest saved target: strategic fit ${t.ESTIMATED.strategic_fit}/100 [ESTIMATED] at ${t.ESTIMATED.ev_ebitda.toFixed(1)}× EBITDA [USER INPUT].\n\n`);
      for (const x of ranked) yield say(`- ${x.USER_INPUT.name}: fit ${x.ESTIMATED.strategic_fit}, revenue synergy ${$(x.ESTIMATED.revenue_synergy)}, integration risk ${x.ESTIMATED.integration_risk} [ESTIMATED] — ${x.ESTIMATED.verdict}\n`);
    }
  } else if (/synerg|combine|work together|merge|partner/.test(q)) {
    const list = (yield* call('get_synergies', { limit: 15 })).ESTIMATED as Json[];
    if (/why|low/.test(q)) {
      const target = vertical ? list.filter((s) => s.a === vertical.id || s.b === vertical.id) : list;
      const low = target[target.length - 1];
      const weak = Object.entries(low.factors as Record<string, number>).sort((a, b) => a[1] - b[1]).slice(0, 3);
      yield say(`${low.pair} scores ${low.score}/100 [ESTIMATED]. The score is held down by its weakest factors: ${weak.map(([k, v]) => `${(SYNERGY_FACTORS.find((f) => f.key === k)?.label ?? k).toLowerCase()} (${p(v)})`).join(', ')} [ESTIMATED].\n\n- Shared customers: ${low.shared_customers} [ACTUAL]\n- Current cross-sell rate: ${p(low.current_cross_sell_rate)} [ACTUAL]\n\nRaising cross-sell or sharing infrastructure lifts the score fastest.`);
    } else {
      const top = list[0];
      yield say(`[[node:${top.a}|${top.pair.split(' ↔ ')[0]}]] and [[node:${top.b}|${top.pair.split(' ↔ ')[1]}]] should work most closely together — synergy ${top.score}/100 [ESTIMATED] with ${$(top.incremental_revenue)} incremental revenue [ESTIMATED] and ${$(top.cost_savings)} cost savings [ESTIMATED].\n\n`);
      for (const s of list.slice(1, 5)) yield say(`- ${s.pair}: ${s.score}/100, ${$(s.incremental_revenue)} upside [ESTIMATED] — ${s.top_drivers.join(', ').toLowerCase()}\n`);
    }
  } else if (/depend|reliant|single point|overdepend/.test(q)) {
    const r = yield* call('get_risks');
    const infra = [...r.ACTUAL.infrastructure_dependencies].sort((x: Json, y: Json) => y.dependents.length - x.dependents.length);
    const conc = r.ACTUAL.segment_concentration[0];
    yield say(`The group is most dependent on **${infra[0].name}** (used by ${infra[0].dependents.length} verticals [ACTUAL]) and on **${conc.segment}**, which drive ${p(conc.share_of_revenue)} of revenue [ACTUAL].\n\n`);
    for (const i of infra.slice(0, 3)) yield say(`- ${i.name}: ${i.dependents.join(', ')}; tech debt ${p(i.tech_debt_estimated)} [ESTIMATED]\n`);
    for (const b of r.ESTIMATED.bottlenecks.filter((b: Json) => b.type === 'personnel').slice(0, 2)) yield say(`- ${b.title} (severity ${p(b.severity)}) [ESTIMATED]\n`);
  } else if (/cross-?sell|which customers|offer|bundle|upsell/.test(q)) {
    const o = (yield* call('get_offer_overlap', { limit: 6 })).ESTIMATED;
    const segs = yield* call('get_customer_segments');
    const best = [...segs.ESTIMATED].sort((x: Json, y: Json) => y.cross_sell_potential - x.cross_sell_potential)[0];
    const seg = segs[Object.keys(segs).find((k) => k !== 'ESTIMATED')!].find((s: Json) => s.id === best.id);
    yield say(`Start with [[node:${seg.id}|${seg.name}]]: ${seg.customers.toLocaleString()} customers [ACTUAL] with ${p(best.cross_sell_potential)} cross-sell potential [ESTIMATED], buying from ${seg.buys_from.length} verticals today [ACTUAL].\n\n`);
    for (const x of o.product_pairs.slice(0, 4)) yield say(`- Offer ${x.b} to ${x.a} buyers: ~${x.new_customers} adopters, ${$(x.incremental_revenue)} [ESTIMATED]\n`);
    if (o.bundles[0]) yield say(`- Bundle: “${o.bundles[0].name}” (${o.bundles[0].components.join(' + ')}) — ${$(o.bundles[0].incremental_revenue)} [ESTIMATED]\n`);
  } else if (/health|score/.test(q)) {
    const h = (yield* call('get_health_breakdown')).ESTIMATED;
    const sorted = [...h.components].sort((x: Json, y: Json) => x.score - y.score);
    yield say(`Business health is ${h.score}/100 (${h.grade}) [ESTIMATED].\n\nWeakest components:\n`);
    for (const c of sorted.slice(0, 3)) yield say(`- ${c.label}: ${c.score}/100 — ${c.why}\n`);
    yield say(`\nStrongest: ${sorted.slice(-2).map((c: Json) => `${c.label} (${c.score})`).join(', ')}.`);
  } else if (/risk|bottleneck|vulnerab|weak/.test(q)) {
    const r = yield* call('get_risks');
    const b = r.ESTIMATED.bottlenecks;
    yield say(`The biggest bottleneck is **${b[0].title}** (severity ${p(b[0].severity)}) [ESTIMATED]. ${b[0].fix}\n\n`);
    for (const x of b.slice(1, 5)) yield say(`- ${x.title} — severity ${p(x.severity)} [ESTIMATED]\n`);
  } else if (vertical) {
    const d = yield* call('get_vertical_details', { vertical_id: vertical.id });
    const key = Object.keys(d).find((k) => k === 'ACTUAL' || k === 'PROJECTED')!;
    const m = d[key], e = d.ESTIMATED;
    yield say(`[[node:${vertical.id}|${d.name}]] generates ${$(m.revenue)} revenue [${key}] growing ${p(m.growth)} [${key}] at a ${p(m.ebitda_margin)} EBITDA margin [${key}].\n\n`);
    if (e.potential) yield say(`- Potential revenue: ${$(e.potential.potential)} (risk-adjusted ${$(e.potential.risk_adjusted)}) [ESTIMATED]\n`);
    for (const s of e.synergies.slice(0, 2)) yield say(`- Synergy with ${s.with}: ${s.score}/100 [ESTIMATED]\n`);
    for (const b of e.bottlenecks.slice(0, 2)) yield say(`- Bottleneck: ${b.title} [ESTIMATED]\n`);
  } else {
    const o = (yield* call('list_opportunities', { limit: 5 })).ESTIMATED as Json[];
    const top = o[0];
    yield say(`The biggest revenue opportunity is **${top.name}**: ${$(top.revenue || top.profit)} [ESTIMATED] at ${p(top.confidence)} confidence [ESTIMATED], needing ${$(top.investment)} [ESTIMATED] over ~${top.months} months.\n\n`);
    for (const x of o.slice(1, 5)) yield say(`- ${x.name}: ${$(x.revenue || x.profit)} [ESTIMATED], ${x.type}\n`);
  }
  yield { type: 'done', model: 'deterministic', engine: 'local' };
}
