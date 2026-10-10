import { z } from 'zod';
import type { AcquisitionInput, CompanyData, ScenarioParams } from '@/lib/domain/types';
import { analyze } from '@/lib/analytics';
import { analyzeAcquisition, ALL_CAPABILITIES, INFRA_CATEGORIES } from '@/lib/analytics/acquisition';
import { METRICS, type MetricKey } from '@/lib/analytics/explain';
import { potentialFor } from '@/lib/analytics/potential';
import { investmentAllocation, milestone, projections, removeVertical } from '@/lib/analytics/whatif';
import { executiveAnswers, investorInsights, strategicMoat } from '@/lib/analytics/insights';
import { OPPORTUNITY_LABEL } from '@/lib/analytics/opportunities';

/**
 * Tools the AI analyst can call. Each one runs the deterministic analytics engine and returns
 * numbers tagged with their provenance; the model is not allowed to state figures it didn't get here.
 */
export interface ToolContext {
  data: CompanyData;
  year: number;
  scenario: ScenarioParams;
  baseline: ScenarioParams;
  acquisitions: AcquisitionInput[];
}

const r = (v: number) => Math.round(v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const ScenarioInput = z.object({
  customerGrowth: z.number().min(-0.5).max(2).optional().describe('Additional customer growth as a fraction, e.g. 0.2 = +20%'),
  pricing: z.number().min(-0.5).max(1).optional().describe('Price change as a fraction, e.g. 0.1 = +10%'),
  crossSellRate: z.number().min(0).max(0.8).optional().describe('Target average cross-sell rate (absolute, e.g. 0.2 = 20%)'),
  retention: z.number().min(0.3).max(0.99).optional().describe('Revenue-weighted retention (absolute, e.g. 0.9)'),
  newVertical: z.number().min(0).max(50_000_000).optional().describe('Revenue contributed by a new vertical in the first year, USD'),
  costEfficiency: z.number().min(0).max(0.5).optional().describe('Opex reduction as a fraction'),
  verticalPlans: z.record(z.string(), z.object({ extraGrowth: z.number().min(-0.9).max(5), startYear: z.number().int() })).optional()
    .describe('Unit-level plans keyed by vertical id: extra annual growth (fades 15%/yr) starting in startYear, e.g. {"creative": {"extraGrowth": 1, "startYear": 2027}}'),
});

const AcqInput = z.object({
  name: z.string(),
  price: z.number(), revenue: z.number(), ebitda: z.number(), customers: z.number(), employees: z.number(), growth: z.number(),
  services: z.array(z.enum(ALL_CAPABILITIES as [string, ...string[]])),
  segments: z.array(z.string()).describe('Segment ids the target serves'),
  geography: z.array(z.string()),
  infra: z.array(z.enum(INFRA_CATEGORIES as [string, ...string[]])),
});

export const TOOL_DEFS = {
  get_company_overview: {
    description: 'Consolidated metrics for the selected year: revenue, growth, EBITDA, customers, recurring share, health score, valuation, plus a per-vertical table. Start here for most questions.',
    input: z.object({}),
  },
  get_vertical_details: {
    description: 'Everything about one vertical (or the parent with id "parent"): financials, unit economics, products, bottlenecks, synergies with every other vertical, and current-vs-potential revenue with its drivers.',
    input: z.object({ vertical_id: z.string().describe('Vertical id, e.g. "marketing", or "parent"') }),
  },
  list_opportunities: {
    description: 'Ranked revenue opportunities from the opportunity engine (cross-sell, upsell, bundle, geographic, customer expansion, subscription, infrastructure/data monetization, vertical integration) with revenue, profit, confidence, difficulty, investment, timing.',
    input: z.object({ type: z.enum(Object.keys(OPPORTUNITY_LABEL) as [string, ...string[]]).optional(), limit: z.number().int().min(1).max(40).optional() }),
  },
  get_synergies: {
    description: 'Synergy scores (0-100) for every pair of verticals with factor breakdown, customer overlap, incremental revenue and cost savings.',
    input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  },
  get_risks: {
    description: 'Detected bottlenecks (sales, operations, technology, customer, financial, personnel) with severity, plus customer concentration and operational dependencies on shared infrastructure.',
    input: z.object({}),
  },
  get_offer_overlap: {
    description: 'Product pairs that sell together (penetration, overlap, adoption, incremental revenue) and auto-detected bundles.',
    input: z.object({ limit: z.number().int().min(1).max(30).optional() }),
  },
  get_customer_segments: {
    description: 'Customer segments: customers, revenue, share, retention, which verticals they buy from, cross-sell potential.',
    input: z.object({}),
  },
  get_health_breakdown: {
    description: 'Business health score with each component score, weight, value and reason.',
    input: z.object({}),
  },
  run_scenario: {
    description: 'Run a what-if on the current year and projections: change any of customer growth, pricing, cross-sell rate, retention, new vertical revenue, cost efficiency, or unit-level growth plans for specific verticals. Returns baseline vs scenario, year-by-year projections and the first year EBITDA reaches $1M. Unspecified parameters stay at baseline.',
    input: ScenarioInput,
  },
  remove_vertical: {
    description: 'Simulate removing a vertical: revenue, EBITDA, customers, health and valuation before/after, lost synergies, lost referral flows, and infrastructure left with fewer users.',
    input: z.object({ vertical_id: z.string() }),
  },
  allocate_investment: {
    description: 'Rank verticals by value created from an additional investment amount (LTV/CAC based, capped by delivery capacity).',
    input: z.object({ amount: z.number().min(10_000).max(100_000_000) }),
  },
  evaluate_acquisition: {
    description: 'Evaluate a hypothetical acquisition target against the group: strategic fit, synergy score, revenue/cost synergies, integration risk, EV/EBITDA, payback.',
    input: AcqInput,
  },
  list_saved_acquisitions: {
    description: 'Acquisition targets the user saved in the Acquisition simulator, each already evaluated. Use to compare targets.',
    input: z.object({}),
  },
  get_projections: {
    description: 'Year-by-year actuals and projections (all years in the dataset) under the current scenario.',
    input: z.object({}),
  },
  explain_metric: {
    description: 'Formula and assumptions behind a metric key.',
    input: z.object({ metric: z.enum(Object.keys(METRICS) as [MetricKey, ...MetricKey[]]) }),
  },
} as const;

export type ToolName = keyof typeof TOOL_DEFS;

export function toolSchemas() {
  return (Object.entries(TOOL_DEFS) as [ToolName, (typeof TOOL_DEFS)[ToolName]][]).map(([name, def]) => {
    const schema = z.toJSONSchema(def.input) as Record<string, unknown>;
    delete schema.$schema;
    return { name, description: def.description, input_schema: { type: 'object' as const, ...schema } };
  });
}

/** Validates the model-provided input against the tool's schema, then runs the engine. */
export function runTool(name: string, rawInput: unknown, ctx: ToolContext): { ok: true; result: unknown } | { ok: false; error: string } {
  const def = TOOL_DEFS[name as ToolName];
  if (!def) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  try {
    return { ok: true, result: execute(name as ToolName, parsed.data as never, ctx) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function execute(name: ToolName, input: Record<string, unknown>, ctx: ToolContext): unknown {
  const { data, year, scenario, baseline } = ctx;
  const a = analyze(data, year, scenario, baseline);
  const scenarioActive = JSON.stringify(scenario) !== JSON.stringify(baseline);
  const periodStatus = year > data.parent.currentYear || scenarioActive ? 'PROJECTED' : 'ACTUAL';
  const { state } = a;
  const vName = (id: string) => state.verticals.find((v) => v.id === id)?.v.name ?? id;

  switch (name) {
    case 'get_company_overview':
      return {
        year, current_year: data.parent.currentYear, scenario_active: scenarioActive,
        [periodStatus]: {
          revenue: r(state.revenue), prior_year_revenue: r(state.prevRevenue), growth: r3(state.growth), ebitda: r(state.ebitda), ebitda_margin: r3(state.ebitdaMargin),
          gross_profit: r(state.grossProfit), customers: state.customers, employees: state.employees, recurring_revenue: r(state.recurringRevenue), recurring_share: r3(state.recurringShare),
          verticals: state.active.map((v) => ({ id: v.id, name: v.v.name, revenue: r(v.revenue), growth: r3(v.growth), ebitda: r(v.ebitda), ebitda_margin: r3(v.ebitdaMargin), customers: v.customers, share_of_revenue: r3(v.revenue / state.revenue) })),
        },
        ESTIMATED: { health_score: a.health.score, health_grade: a.health.grade, enterprise_value: r(a.valuation.ev), ev_ebitda_multiple: r3(a.valuation.multiple), strategic_moat: strategicMoat(data, { ...a }) },
        generated_insights: investorInsights(data, { ...a }).map((i) => i.text),
      };

    case 'get_vertical_details': {
      const id = String(input.vertical_id);
      const pot = potentialFor(id, data, a, baseline);
      if (id === 'parent') return { note: 'Use get_company_overview for parent totals.', ESTIMATED_potential: pot && { current: r(pot.current), potential: r(pot.potential), risk_adjusted: r(pot.riskAdjusted), drivers: pot.drivers.slice(0, 10).map((d) => ({ ...d, amount: r(d.amount) })) } };
      const vs = state.verticals.find((v) => v.id === id);
      if (!vs) return { error: `No vertical "${id}". Valid ids: ${state.verticals.map((v) => v.id).join(', ')}` };
      if (!vs.active) return { error: `${vs.v.name} has no revenue in ${year}${vs.v.launchYear ? ` (launches ${vs.v.launchYear})` : ''}.` };
      const v = vs.v;
      return {
        id, name: v.name, description: v.description,
        [periodStatus]: {
          revenue: r(vs.revenue), growth: r3(vs.growth), gross_margin: v.grossMargin, ebitda: r(vs.ebitda), ebitda_margin: r3(vs.ebitdaMargin), customers: vs.customers, employees: vs.employees,
          revenue_per_customer: r(vs.arpc), revenue_per_employee: r(vs.revenue / Math.max(1, vs.employees)), recurring_share: v.recurringShare, retention: v.retention, cac: v.cac, marketing_spend: v.marketingSpend,
          leads_per_month: v.ops.leadsPerMonth, leads_needed_per_month: v.ops.leadsNeeded, utilization: v.ops.utilization, top_customer_share: v.ops.topCustomerShare,
          products: data.products.filter((p) => p.vertical === id && state.products[p.id]?.active).map((p) => ({ id: p.id, name: p.name, revenue: r(state.products[p.id].revenue), growth: r3(state.products[p.id].growth), margin: p.margin, customers: state.products[p.id].customers, recurring: p.recurring })),
        },
        ESTIMATED: {
          ltv: v.ltv, contribution_margin: v.contributionMargin, tam: v.tam, sam: v.sam, penetration_of_sam: r3(vs.revenue / v.sam), strategic_importance: v.strategicImportance, growth_potential: v.growthPotential,
          required_investment: v.requiredInvestment, key_person_risk: v.ops.keyPersonRisk, risks: v.risks,
          bottlenecks: a.bottlenecks.filter((b) => b.nodeId === id).map((b) => ({ type: b.type, severity: r3(b.severity), title: b.title, fix: b.fix })),
          synergies: a.synergies.filter((s) => s.a === id || s.b === id).map((s) => ({ with: vName(s.a === id ? s.b : s.a), score: s.score, incremental_revenue: r(s.incrementalRevenue), cost_savings: r(s.costSavings), drivers: s.topDrivers })),
          potential: pot && { current: r(pot.current), potential: r(pot.potential), risk_adjusted: r(pot.riskAdjusted), drivers: pot.drivers.slice(0, 8).map((d) => ({ label: d.label, amount: r(d.amount), confidence: d.confidence })) },
        },
      };
    }

    case 'list_opportunities': {
      const list = a.opportunities.filter((o) => !input.type || o.type === input.type).slice(0, Number(input.limit ?? 12));
      return { ESTIMATED: list.map((o) => ({ name: o.name, type: OPPORTUNITY_LABEL[o.type], description: o.description, revenue: r(o.revenue), profit: r(o.profit), confidence: o.confidence, difficulty: r3(o.difficulty), investment: r(o.investment), months: o.months, strategic_impact: o.impact, dependencies: o.dependencies, score: r(o.score), node_ids: o.nodeIds })) };
    }

    case 'get_synergies':
      return { ESTIMATED: a.synergies.slice(0, Number(input.limit ?? 20)).map((s) => ({ a: s.a, b: s.b, pair: `${vName(s.a)} ↔ ${vName(s.b)}`, score: s.score, shared_customers: s.pair.sharedCustomers, overlap_pct_a: r3(s.overlapPctA), overlap_pct_b: r3(s.overlapPctB), incremental_revenue: r(s.incrementalRevenue), cost_savings: r(s.costSavings), current_cross_sell_rate: s.pair.currentCrossSellRate, target_cross_sell_rate: s.pair.targetCrossSellRate, factors: Object.fromEntries(Object.entries(s.factors).map(([k, v]) => [k, r3(v)])), top_drivers: s.topDrivers })) };

    case 'get_risks':
      return {
        ESTIMATED: { bottlenecks: a.bottlenecks.map((b) => ({ node: b.nodeId, type: b.type, severity: r3(b.severity), title: b.title, detail: b.detail, fix: b.fix })) },
        ACTUAL: {
          segment_concentration: state.segments.map((s) => ({ segment: s.s.name, share_of_revenue: r3(s.share) })).sort((x, y) => y.share_of_revenue - x.share_of_revenue),
          top_customer_share_of_group: data.parent.topCustomerShare,
          infrastructure_dependencies: data.infra.map((i) => ({ name: i.name, dependents: i.dependents.map(vName), tech_debt_estimated: i.techDebt, annual_cost: i.annualCost })),
          shared_teams: data.functions.map((f) => ({ name: f.name, fte: f.fte, utilization: f.utilization, serves: f.serves.map(vName) })),
          working_capital_months: data.parent.workingCapitalMonths, cash: data.parent.cash, debt: data.parent.debt,
        },
      };

    case 'get_offer_overlap':
      return {
        ESTIMATED: {
          product_pairs: a.offerPairs.slice(0, Number(input.limit ?? 12)).map((o) => ({ a: o.a.name, b: o.b.name, affinity: o.affinity, customers_a: o.customersA, customers_b: o.customersB, currently_buy_both: o.currentBoth, penetration: r3(o.penetration), adoption_estimate: r3(o.adoption), new_customers: o.newCustomers, incremental_revenue: r(o.incrementalRevenue), incremental_margin: r(o.incrementalMargin), strategic_value: o.strategicValue })),
          bundles: a.bundles.map((b) => ({ name: b.name, components: b.members.map((m) => m.name), verticals: b.verticals.map(vName), annual_price: r(b.price), adoption_estimate: r3(b.adoption), new_customers: b.newCustomers, incremental_revenue: r(b.incrementalRevenue), margin: r3(b.margin), strategic_value: b.strategicValue })),
        },
      };

    case 'get_customer_segments':
      return { [periodStatus]: state.segments.map((s) => ({ id: s.id, name: s.s.name, customers: s.customers, revenue: r(s.revenue), share_of_revenue: r3(s.share), retention: s.s.retention, buys_from: s.verticals.map(vName), average_customer_value: r(s.revenue / Math.max(1, s.customers)) })), ESTIMATED: state.segments.map((s) => ({ id: s.id, cross_sell_potential: s.s.crossSellPotential })) };

    case 'get_health_breakdown':
      return { ESTIMATED: { score: a.health.score, grade: a.health.grade, components: a.health.components.map((c) => ({ label: c.label, score: c.score, weight: c.weight, value: c.value, why: c.why })) } };

    case 'run_scenario': {
      const s: ScenarioParams = { ...baseline, ...(input as Partial<ScenarioParams>) };
      const cur = data.parent.currentYear;
      const base = analyze(data, cur, baseline, baseline);
      const next = analyze(data, cur, s, baseline);
      const pick = (x: typeof base) => ({ revenue: r(x.state.revenue), growth: r3(x.state.growth), ebitda: r(x.state.ebitda), ebitda_margin: r3(x.state.ebitdaMargin), customers: x.state.customers, recurring_share: r3(x.state.recurringShare), health: x.health.score, enterprise_value: r(x.valuation.ev) });
      return {
        USER_INPUT: { scenario: s, baseline },
        ACTUAL_baseline_current_year: pick(base),
        PROJECTED_scenario_current_year_run_rate: pick(next),
        PROJECTED_by_year: projections(data, s, baseline).map((p) => ({ year: p.year, kind: p.kind, revenue: r(p.revenue), ebitda: r(p.ebitda), customers: p.customers, by_vertical: Object.fromEntries(Object.entries(p.byVertical).map(([k, v]) => [k, r(v)])) })),
        PROJECTED_first_year_ebitda_1M: milestone(data, s, baseline, 'ebitda', 1_000_000),
        PROJECTED_first_year_revenue_1M: milestone(data, s, baseline, 'revenue', 1_000_000),
        revenue_bridge: next.state.active.map((v) => ({ vertical: v.v.name, volume: r(v.components.volume), price: r(v.components.price), cross_sell: r(v.components.crossSell), efficiency_ebitda: r(v.components.efficiency) })),
        method: METRICS.ebitda.formula,
      };
    }

    case 'remove_vertical': {
      const res = removeVertical(data, String(input.vertical_id));
      return res ? { ESTIMATED: res } : { error: `No vertical "${input.vertical_id}"` };
    }

    case 'allocate_investment':
      return { ESTIMATED: { amount: input.amount, ranking: investmentAllocation(data, Number(input.amount)).map((x) => ({ ...x, firstYearRevenue: r(x.firstYearRevenue), valueCreated: r(x.valueCreated), roi: r3(x.roi), ltvCac: r3(x.ltvCac) })), method: METRICS.investmentReturn.formula } };

    case 'evaluate_acquisition': {
      const res = analyzeAcquisition(data, state, input as unknown as AcquisitionInput);
      return { USER_INPUT: input, ESTIMATED: { ...res, revenueSynergy: r(res.revenueSynergy), costSynergy: r(res.costSynergy), evEbitda: r3(res.evEbitda), paybackYears: r3(res.paybackYears) } };
    }

    case 'list_saved_acquisitions':
      if (!ctx.acquisitions.length) return { note: 'No saved acquisition targets. The user can add them in the Acquisition simulator, or you can evaluate a described target with evaluate_acquisition.' };
      return { targets: ctx.acquisitions.map((t) => { const res = analyzeAcquisition(data, state, t); return { USER_INPUT: { name: t.name, price: t.price, revenue: t.revenue, ebitda: t.ebitda, growth: t.growth }, ESTIMATED: { strategic_fit: res.strategicFit, synergy_score: res.synergyScore, revenue_synergy: r(res.revenueSynergy), cost_synergy: r(res.costSynergy), integration_risk: res.integrationRisk, ev_ebitda: r3(res.evEbitda), payback_years: r3(res.paybackYears), verdict: res.verdict } }; }) };

    case 'get_projections':
      return { active_unit_plans_USER_INPUT: scenario.verticalPlans ?? {}, first_year_ebitda_1M: milestone(data, scenario, baseline, 'ebitda', 1_000_000), rows: projections(data, scenario, baseline).map((p) => ({ year: p.year, status: p.kind.toUpperCase(), revenue: r(p.revenue), growth: r3(p.growth), ebitda: r(p.ebitda), customers: p.customers, health_estimated: p.health, enterprise_value_estimated: r(p.ev) })) };

    case 'explain_metric':
      return METRICS[input.metric as MetricKey];
  }
}

/** Used by the deterministic analyst and for the exec summary — same answers, no model. */
export function executiveSummary(ctx: ToolContext) {
  const a = analyze(ctx.data, ctx.year, ctx.scenario, ctx.baseline);
  return executiveAnswers(ctx.data, { ...a });
}
