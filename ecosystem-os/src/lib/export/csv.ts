import type { CompanyData, ScenarioParams } from '@/lib/domain/types';
import { analyze } from '@/lib/analytics';
import { projections } from '@/lib/analytics/whatif';

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n';
const r = (v: number) => Math.round(v);
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Entity-level snapshot of the selected year: one row per vertical, product and segment. */
export function entitiesCsv(data: CompanyData, year: number, scenario: ScenarioParams, baseline: ScenarioParams) {
  const a = analyze(data, year, scenario, baseline);
  const status = year > data.parent.currentYear || JSON.stringify(scenario) !== JSON.stringify(baseline) ? 'projected' : 'actual';
  const rows: unknown[][] = [];
  for (const v of a.state.active) rows.push(['vertical', v.id, v.v.name, '', year, status, r(v.revenue), r4(v.growth), r(v.ebitda), r4(v.ebitdaMargin), v.customers, v.employees, r4(v.v.recurringShare)]);
  for (const p of Object.values(a.state.products).filter((x) => x.active)) rows.push(['product', p.id, p.p.name, p.p.vertical, year, status, r(p.revenue), r4(p.growth), r(p.profit), r4(p.p.margin), p.customers, '', p.p.recurring ? 1 : 0]);
  for (const s of a.state.segments) rows.push(['segment', s.id, s.s.name, s.verticals.join('|'), year, status, r(s.revenue), '', '', '', s.customers, '', '']);
  return toCsv(['type', 'id', 'name', 'parent', 'year', 'status', 'revenue', 'growth', 'ebitda_or_profit', 'margin', 'customers', 'employees', 'recurring'], rows);
}

export function projectionsCsv(data: CompanyData, scenario: ScenarioParams, baseline: ScenarioParams) {
  const rows = projections(data, scenario, baseline);
  const verticals = [...new Set(rows.flatMap((x) => Object.keys(x.byVertical)))];
  return toCsv(
    ['year', 'status', 'revenue', 'growth', 'gross_profit', 'ebitda', 'ebitda_margin', 'customers', 'employees', 'recurring_share', 'health_estimated', 'enterprise_value_estimated', ...verticals.map((v) => `revenue_${v}`)],
    rows.map((x) => [x.year, x.kind, r(x.revenue), r4(x.growth), r(x.grossProfit), r(x.ebitda), r4(x.ebitdaMargin), x.customers, x.employees, r4(x.recurringShare), x.health, r(x.ev), ...verticals.map((v) => r(x.byVertical[v] ?? 0))]),
  );
}

export function opportunitiesCsv(data: CompanyData, year: number, scenario: ScenarioParams, baseline: ScenarioParams) {
  const a = analyze(data, year, scenario, baseline);
  return toCsv(
    ['name', 'type', 'revenue_estimated', 'profit_estimated', 'confidence', 'difficulty', 'investment', 'months', 'strategic_impact', 'score', 'dependencies'],
    a.opportunities.map((o) => [o.name, o.type, r(o.revenue), r(o.profit), o.confidence, r4(o.difficulty), r(o.investment), o.months, o.impact, r(o.score), o.dependencies.join('; ')]),
  );
}

export function download(filename: string, content: string | Blob, type = 'text/csv') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
