import type { NodeKind, RelType } from '@/lib/domain/types';

// ─── Vertical colour system ─────────────────────────────────────────────────
// Validated categorical palette (dark surface #0c1015: lightness band, chroma, CVD ΔE ≥ 8.4,
// normal-vision ΔE ≥ 19.3, contrast ≥ 3:1). Slot order is the CVD-safety mechanism — don't reorder.
export const CATEGORICAL = [
  { hex: '#3987e5', hue: 255 }, // blue
  { hex: '#d95926', hue: 40 }, // orange
  { hex: '#199e70', hue: 165 }, // aqua
  { hex: '#c98500', hue: 75 }, // yellow
  { hex: '#d55181', hue: 350 }, // magenta
  { hex: '#008300', hue: 140 }, // green
  { hex: '#9085e9', hue: 285 }, // violet
  { hex: '#e66767', hue: 22 }, // red
];

export interface VerticalColor { base: string; light: string; tint: string; slot: number }

const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Each vertical keeps its colour for its lifetime (colour follows the entity, never rank): verticals
 * are taken in data order and snapped to the nearest unused slot to their preferred hue. Beyond eight,
 * slots repeat; graph nodes are always direct-labelled, so identity never relies on colour alone.
 */
export function assignVerticalColors(verticals: { id: string; hue: number }[]): Record<string, VerticalColor> {
  const used = new Set<number>();
  const out: Record<string, VerticalColor> = {};
  verticals.forEach((v, i) => {
    let slot = -1;
    if (used.size < CATEGORICAL.length) {
      slot = CATEGORICAL.map((c, k) => ({ k, d: hueDist(c.hue, v.hue) })).filter((x) => !used.has(x.k)).sort((a, b) => a.d - b.d)[0].k;
      used.add(slot);
    } else slot = i % CATEGORICAL.length;
    const base = CATEGORICAL[slot].hex;
    out[v.id] = { base, light: `color-mix(in oklch, ${base} 62%, white)`, tint: `color-mix(in oklch, ${base} 16%, transparent)`, slot };
  });
  return out;
}

export const KIND_COLOR: Partial<Record<NodeKind | 'cluster', string>> = {
  parent: '#F2EBDD',
  segment: '#D8DEE9',
  infra: '#7FA3B8',
  function: '#9AA3AE',
  acquisition: '#FFD166',
  cluster: '#7E8A99',
};

// ─── Relationship styles ────────────────────────────────────────────────────

export type EdgeKind = RelType | 'journey' | 'acquisition' | 'affinity';

export interface EdgeStyle {
  label: string;
  color: string;
  dash?: string;
  flow?: boolean; // animated particles travelling source → target
  march?: boolean; // animated dashes
  arrow?: boolean;
  description: string;
}

export const EDGE_STYLES: Record<EdgeKind, EdgeStyle> = {
  ownership: { label: 'Ownership', color: 'rgba(214,222,235,0.16)', description: 'Structural parent → child link' },
  revenue: { label: 'Revenue flow', color: '#E5C26B', flow: true, description: 'Money moving between nodes; particle density = $ volume' },
  customer_overlap: { label: 'Customer overlap', color: '#5EC8E5', dash: '1 5', description: 'Customers buying from both sides' },
  dependency: { label: 'Operational dependency', color: '#F07167', dash: '10 5', arrow: true, description: 'Source cannot operate without target' },
  cross_sell: { label: 'Cross-sell', color: '#C08CFF', dash: '6 4', march: true, description: 'Existing or identified cross-sell path' },
  shared_infra: { label: 'Shared infrastructure', color: '#8FA3B8', description: 'Uses the same systems or facilities' },
  partnership: { label: 'Strategic partnership', color: '#2EC4B6', dash: '12 3 2 3', description: 'Formal program between verticals' },
  shared_tech: { label: 'Shared technology', color: '#4EA8DE', dash: '4 3', description: 'Common technology stack' },
  shared_employees: { label: 'Shared employees', color: '#F4A261', dash: '1 3', description: 'People working across both' },
  shared_marketing: { label: 'Shared marketing', color: '#FF85A1', dash: '6 2', description: 'Shared audiences, brand or campaigns' },
  shared_data: { label: 'Shared data', color: '#A7C957', dash: '2 2', march: true, description: 'Data flowing between systems' },
  shared_distribution: { label: 'Shared distribution', color: '#B9A3E3', dash: '14 4', description: 'Same channels or fulfillment' },
  affinity: { label: 'Offer affinity', color: '#C08CFF', dash: '2 4', description: 'Products that naturally sell together' },
  journey: { label: 'Customer journey', color: '#FFFFFF', flow: true, description: 'Highlighted path a customer takes through the ecosystem' },
  acquisition: { label: 'Acquisition fit', color: '#FFD166', dash: '3 5', march: true, description: 'How a target would plug into the group' },
};

// ─── Graph modes ────────────────────────────────────────────────────────────

export type GraphMode = 'ecosystem' | 'revenue' | 'customer' | 'synergy' | 'operations' | 'investor' | 'risk' | 'growth';
export type FlowMetric = 'revenue' | 'profit' | 'customers' | 'leads' | 'crossSells' | 'resources' | 'data' | 'technology' | 'employees';

export interface ModeDef {
  label: string;
  question: string;
  metric: FlowMetric;
  edges: EdgeKind[];
  showSegments: boolean;
  showInfra: boolean;
  collapseAll?: boolean;
}

export const MODES: Record<GraphMode, ModeDef> = {
  ecosystem: { label: 'Ecosystem', question: 'How does the whole company fit together?', metric: 'revenue', edges: ['ownership', 'revenue', 'cross_sell', 'dependency', 'partnership'], showSegments: false, showInfra: false },
  revenue: { label: 'Revenue', question: 'Where does money come from and how does it move?', metric: 'revenue', edges: ['ownership', 'revenue', 'journey'], showSegments: true, showInfra: false },
  customer: { label: 'Customer', question: 'Who buys what, and who is shared?', metric: 'customers', edges: ['ownership', 'revenue', 'customer_overlap', 'cross_sell'], showSegments: true, showInfra: false },
  synergy: { label: 'Synergy', question: 'Which parts make each other stronger?', metric: 'crossSells', edges: ['ownership', 'cross_sell', 'affinity', 'shared_marketing', 'shared_tech', 'shared_data', 'shared_employees', 'partnership'], showSegments: false, showInfra: false },
  operations: { label: 'Operations', question: 'What do we depend on to deliver?', metric: 'technology', edges: ['ownership', 'dependency', 'shared_infra', 'shared_employees', 'shared_data'], showSegments: false, showInfra: true },
  investor: { label: 'Investor', question: 'Where is value created and how does it scale?', metric: 'profit', edges: ['ownership', 'revenue', 'cross_sell'], showSegments: false, showInfra: false, collapseAll: true },
  risk: { label: 'Risk', question: 'Where are we vulnerable or concentrated?', metric: 'revenue', edges: ['ownership', 'dependency', 'customer_overlap', 'revenue'], showSegments: true, showInfra: true },
  growth: { label: 'Growth', question: 'Where can we expand next?', metric: 'revenue', edges: ['ownership', 'cross_sell', 'affinity', 'acquisition'], showSegments: false, showInfra: false },
};

export const METRIC_LABEL: Record<FlowMetric, string> = {
  revenue: 'Revenue', profit: 'Profit', customers: 'Customers', leads: 'Leads', crossSells: 'Cross-sells',
  resources: 'Resources', data: 'Data', technology: 'Technology', employees: 'Employees',
};

/** Which relationship carries the animated flow for a metric. */
export const METRIC_FLOW_EDGES: Record<FlowMetric, EdgeKind[]> = {
  revenue: ['revenue', 'ownership', 'journey'],
  profit: ['revenue', 'ownership'],
  customers: ['customer_overlap', 'revenue'],
  leads: ['revenue', 'shared_marketing', 'cross_sell'],
  crossSells: ['cross_sell', 'affinity'],
  resources: ['shared_infra', 'shared_employees'],
  data: ['shared_data'],
  technology: ['shared_tech', 'dependency', 'shared_infra'],
  employees: ['shared_employees'],
};
