import type { DataStatus } from '@/lib/domain/types';

/**
 * Formula registry. Every metric the UI shows has an entry here, so a user can click any
 * number and see exactly how it was produced and what kind of number it is.
 */
export interface MetricDef {
  label: string;
  formula: string;
  notes?: string;
  kind: DataStatus; // nature of the metric when shown for the current period without a scenario
}

export const METRICS = {
  revenue: { label: 'Revenue', kind: 'actual', formula: 'Σ product revenue for the period. Future years: last actual × (1 + growth), growth decaying 15%/yr.' },
  growth: { label: 'Revenue growth', kind: 'actual', formula: 'revenue(year) ÷ revenue(year − 1) − 1' },
  grossMargin: { label: 'Gross margin', kind: 'actual', formula: '(revenue − cost of delivery) ÷ revenue' },
  grossProfit: { label: 'Gross profit', kind: 'actual', formula: 'revenue × gross margin' },
  ebitda: { label: 'EBITDA', kind: 'actual', formula: 'base revenue × EBITDA margin + Δvolume × contribution margin + Δprice × 90% + Δcross-sell × gross margin × 85% + opex × efficiency gain', notes: 'Without a scenario this reduces to revenue × EBITDA margin.' },
  ebitdaMargin: { label: 'EBITDA margin', kind: 'actual', formula: 'EBITDA ÷ revenue' },
  contributionMargin: { label: 'Contribution margin', kind: 'estimated', formula: '(revenue − variable costs) ÷ revenue', notes: 'Management estimate; used to value incremental volume.' },
  revenuePerCustomer: { label: 'Revenue per customer', kind: 'actual', formula: 'revenue ÷ customers' },
  revenuePerEmployee: { label: 'Revenue per employee', kind: 'actual', formula: 'revenue ÷ employees' },
  cac: { label: 'Customer acquisition cost', kind: 'actual', formula: 'sales & marketing spend ÷ new customers' },
  ltv: { label: 'Lifetime value', kind: 'estimated', formula: 'ARPC × gross margin ÷ (1 − retention)', notes: 'Depends on assumed future retention.' },
  ltvCac: { label: 'LTV : CAC', kind: 'estimated', formula: 'LTV ÷ CAC — above 3× is generally healthy.' },
  recurring: { label: 'Recurring revenue', kind: 'actual', formula: 'revenue × recurring share (subscriptions, retainers, leases)' },
  oneTime: { label: 'One-time revenue', kind: 'actual', formula: 'revenue × (1 − recurring share)' },
  retention: { label: 'Retention', kind: 'actual', formula: 'customers retained over 12 months ÷ customers at start' },
  tam: { label: 'TAM', kind: 'estimated', formula: 'Total addressable market — management estimate.' },
  sam: { label: 'SAM', kind: 'estimated', formula: 'Serviceable addressable market — management estimate.' },
  penetration: { label: 'Market penetration', kind: 'estimated', formula: 'revenue ÷ SAM' },
  synergy: {
    label: 'Synergy score', kind: 'estimated',
    formula: '100 × Σ weight × factor. Weights: customer overlap 16%, revenue potential 14%, cross-selling 12%, shared infra 10%, shared tech 10%, shared marketing 10%, shared employees 8%, operational efficiency 8%, data 6%, distribution 6%.',
    notes: 'Overlap = shared ÷ smaller customer base × 2 (capped). Revenue potential and efficiency are normalised against the best pair (square root).',
  },
  synergyRevenue: { label: 'Synergy revenue', kind: 'estimated', formula: 'Σ direction: eligible customers × (target − current cross-sell rate) × ARPC of the other vertical × 35% starter ticket + 30% of existing referral flow' },
  synergyCost: { label: 'Synergy cost savings', kind: 'estimated', formula: 'shared infra cost × 20% + shared FTE × $85K × 25% + shared-marketing intensity × min(marketing spend) × 20%' },
  health: { label: 'Business health', kind: 'estimated', formula: 'Weighted average of 11 component scores, each mapped linearly from a "bad" to a "good" threshold. Click the components for each threshold.' },
  opportunityScore: { label: 'Opportunity score', kind: 'estimated', formula: '(profit + 30% × revenue) × confidence × (0.5 + impact ÷ 10) ÷ √(investment + $25K)' },
  riskScore: { label: 'Risk score', kind: 'estimated', formula: '100 × (1 − Π(1 − severity)) across the bottlenecks attached to the node' },
  strategicFit: { label: 'Strategic fit', kind: 'estimated', formula: '100 × (25% service overlap + 25% customer overlap + 20% adjacency to verticals + 10% infra overlap + 20% growth vs 30%)' },
  valuation: { label: 'Enterprise value', kind: 'estimated', formula: 'EBITDA × multiple, multiple = (5 + 18 × min(growth, 35%) + 4 × recurring share + (health − 50) ÷ 25, clamped 4–22×) × size factor', notes: 'Size factor = (log10(EBITDA) − 4) ÷ 3, clamped 0.25–1: owner-run businesses trade at a fraction of scaled-company multiples. Indicative, not an appraisal.' },
  crossSell: { label: 'Cross-sell potential', kind: 'estimated', formula: 'non-buyers × adoption (affinity × 20%, 2–30%) × annual value × 60% realisation', notes: 'Annual value is capped at 4× what the buyer already spends on the source product (min $5K) — a $1.8K/yr software customer won\'t start a $78K retainer.' },
  upsell: { label: 'Upsell potential', kind: 'estimated', formula: 'customers × upgrade rate × annual price uplift' },
  potential: { label: 'Potential revenue', kind: 'estimated', formula: 'current revenue + two years of base-case organic growth + Σ identified opportunities on this node', notes: 'Risk-adjusted potential multiplies each opportunity by its confidence.' },
  investmentReturn: { label: 'Return on $ invested', kind: 'estimated', formula: '(investment × 70% ÷ CAC) new customers × LTV × gross margin × capacity factor; capacity factor = 1 up to 85% utilization, falling linearly to 0.1 at 97%' },
} satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;
