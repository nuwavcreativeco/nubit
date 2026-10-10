import type { CompanyData } from '@/lib/domain/types';
import type { CompanyState } from './model';
import type { Bottleneck } from './bottlenecks';
import { avg, clamp, money, pct, sum } from './format';

export interface HealthComponent {
  key: string;
  label: string;
  score: number; // 0-100
  weight: number;
  value: string;
  why: string;
}

export interface Health {
  score: number;
  grade: string;
  components: HealthComponent[];
  strengths: HealthComponent[];
  drags: HealthComponent[];
}

const hhi = (shares: number[]) => sum(shares.map((s) => s * s));

/** Linear map: `bad` → 0, `good` → 100. */
const scale = (v: number, bad: number, good: number) => Math.round(100 * clamp((v - bad) / (good - bad)));

export function computeHealth(data: CompanyData, state: CompanyState, bottlenecks: Bottleneck[]): Health {
  const rev = state.revenue || 1;
  const verts = state.active;
  const vShares = verts.map((v) => v.revenue / rev);
  const sShares = state.segments.map((s) => s.share);
  const retention = sum(verts.map((v) => v.v.retention * v.revenue)) / rev;
  const revPerEmp = state.revenue / Math.max(1, state.employees);
  // A vertical launched this year has no growth history; judge it on margin alone.
  const healthyVerts = verts.filter((v) => (v.prevRevenue > 0 ? v.growth >= 0.1 : true) && v.ebitdaMargin >= 0.1);
  const avgGM = sum(verts.map((v) => v.v.grossMargin * v.revenue)) / rev;
  // Risk looks at how severe the worst problems are, not how many minor ones exist.
  const worst = [...bottlenecks].sort((x, y) => y.severity - x.severity).slice(0, 5);
  const riskLoad = worst.length ? sum(worst.map((b) => b.severity)) / worst.length : 0;
  const topCust = data.parent.topCustomerShare;
  const effectiveN = (shares: number[]) => (shares.length ? 1 / hhi(shares) : 0);

  const top = [...verts].sort((a, b) => b.revenue - a.revenue)[0];
  const topSeg = [...state.segments].sort((a, b) => b.share - a.share)[0];

  const components: HealthComponent[] = [
    {
      key: 'growth', label: 'Revenue growth', weight: 0.14, score: scale(state.growth, 0, 0.25),
      value: pct(state.growth, { sign: true }),
      why: state.growth >= 0.2 ? 'Growth above 20% is top-quartile for a diversified holding company.' : `Growth of ${pct(state.growth)} is below the 25% that earns full marks.`,
    },
    {
      key: 'profit', label: 'Profitability', weight: 0.12, score: scale(state.ebitdaMargin, 0.03, 0.25),
      value: `${pct(state.ebitdaMargin)} EBITDA`,
      why: `EBITDA margin of ${pct(state.ebitdaMargin)}; 25% would be best in class for this mix.`,
    },
    {
      key: 'customerDiv', label: 'Customer diversification', weight: 0.08, score: scale(effectiveN(sShares), 1.5, 5),
      value: `${effectiveN(sShares).toFixed(1)} effective segments`,
      why: topSeg ? `${topSeg.s.name} account for ${pct(topSeg.share)} of revenue.` : 'No segment data.',
    },
    {
      key: 'revenueDiv', label: 'Revenue diversification', weight: 0.08, score: scale(effectiveN(vShares), 1.5, 5),
      value: `${effectiveN(vShares).toFixed(1)} effective verticals`,
      why: top ? `Largest vertical (${top.v.name}) is ${pct(top.revenue / rev)} of revenue.` : '',
    },
    {
      key: 'recurring', label: 'Recurring revenue', weight: 0.12, score: scale(state.recurringShare, 0.2, 0.75),
      value: pct(state.recurringShare),
      why: `${money(state.recurringRevenue)} of revenue renews automatically; 75%+ earns full marks.`,
    },
    {
      key: 'retention', label: 'Retention', weight: 0.1, score: scale(retention, 0.5, 0.92),
      value: pct(retention),
      why: `Revenue-weighted retention is ${pct(retention)}.`,
    },
    {
      key: 'verticalPerf', label: 'Vertical performance', weight: 0.08, score: Math.round(100 * (healthyVerts.length / Math.max(1, verts.length))),
      value: `${healthyVerts.length}/${verts.length} healthy`,
      why: `${healthyVerts.length} of ${verts.length} verticals clear 10% growth (new verticals exempt) and 10% EBITDA margin.`,
    },
    {
      key: 'efficiency', label: 'Operational efficiency', weight: 0.08, score: scale(revPerEmp, 50_000, 250_000),
      value: `${money(revPerEmp)}/employee`,
      why: `Revenue per employee of ${money(revPerEmp)}; $250K+ indicates strong leverage.`,
    },
    {
      key: 'concentration', label: 'Customer concentration', weight: 0.06, score: scale(-topCust, -0.2, -0.02),
      value: `Top customer ${pct(topCust)}`,
      why: `The single largest customer is ${pct(topCust)} of total revenue.`,
    },
    {
      key: 'risk', label: 'Risk', weight: 0.08, score: scale(-riskLoad, -0.9, -0.2),
      value: `${bottlenecks.filter((b) => b.severity >= 0.75).length} critical bottlenecks`,
      why: `${bottlenecks.length} bottlenecks detected; the worst five average ${Math.round(riskLoad * 100)}% severity.`,
    },
    {
      key: 'scalability', label: 'Scalability', weight: 0.06, score: Math.round(avg([scale(avgGM, 0.3, 0.75), scale(state.recurringShare, 0.2, 0.75)])),
      value: `${pct(avgGM)} gross margin`,
      why: 'Blend of gross margin and recurring share — how cheaply each new dollar can be served.',
    },
  ];

  const score = Math.round(sum(components.map((c) => c.score * c.weight)) / sum(components.map((c) => c.weight)));
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Strong' : score >= 55 ? 'Fair' : score >= 40 ? 'Weak' : 'At risk';
  const sorted = [...components].sort((a, b) => b.score - a.score);
  return { score, grade, components, strengths: sorted.slice(0, 3), drags: sorted.slice(-3).reverse() };
}
