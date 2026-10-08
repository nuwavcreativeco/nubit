import type { AcquisitionInput, CompanyData, DataStatus, NodeKind } from '@/lib/domain/types';
import type { FullAnalysis } from '@/lib/analytics';
import type { AcquisitionAnalysis } from '@/lib/analytics/acquisition';
import { bottlenecksByNode, riskScore } from '@/lib/analytics/bottlenecks';
import { NEW_VERTICAL_ID } from '@/lib/analytics/model';
import { money, num, pct, sum } from '@/lib/analytics/format';
import { assignVerticalColors, EDGE_STYLES, KIND_COLOR, METRIC_FLOW_EDGES, MODES, type EdgeKind, type FlowMetric, type GraphMode } from './theme';
import { computeLayout, type Point } from './layout';

export const SEGMENT_CLUSTER = 'cluster:segments';
export const INFRA_CLUSTER = 'cluster:infra';

export interface GraphInput {
  data: CompanyData;
  analysis: FullAnalysis;
  mode: GraphMode;
  metric: FlowMetric;
  expanded: Set<string>;
  hiddenEdges: Set<EdgeKind>;
  hiddenKinds: Set<NodeKind>;
  verticalFilter: Set<string>;
  search: string;
  focusId: string | null; // hovered or selected node
  selectedId: string | null;
  journeyId: string | null;
  acquisition: { input: AcquisitionInput; analysis: AcquisitionAnalysis } | null;
  positions: Record<string, Point>;
  scenarioActive: boolean;
}

export type GKind = NodeKind | 'cluster';

interface NodeBase {
  kind: GKind;
  label: string;
  sublabel: string;
  valueLabel: string;
  value: number;
  size: number;
  color: string;
  tint: string;
  hue?: number;
  icon?: string;
  verticalId?: string;
  dim: boolean;
  highlight: boolean;
  selected: boolean;
  matched: boolean;
  risk: number; // 0-1
  riskCount: number;
  opportunity: number;
  growth: number | null;
  badge?: string;
  status: DataStatus;
  ghost: boolean;
  count?: number;
  expanded?: boolean;
  mode: GraphMode;
}
export type GNodeData = NodeBase & Record<string, unknown>;

export interface GEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  color: string;
  dash?: string;
  arrow: boolean;
  march: boolean;
  flow: boolean;
  particles: number;
  duration: number;
  width: number;
  strength: number;
  label?: string;
  showLabel: boolean;
  dim: boolean;
  highlight: boolean;
  curvature: number;
  note?: string;
}

export interface GNode { id: string; type: 'entity'; position: Point; data: GNodeData; draggable: boolean; zIndex: number }
export interface GEdge { id: string; source: string; target: string; type: 'flow'; data: GEdgeData; zIndex: number }

interface RawEdge { id: string; source: string; target: string; kind: EdgeKind; value: number; strength: number; label?: string; note?: string; forceLabel?: boolean; highlight?: boolean }

export function buildGraph(input: GraphInput): { nodes: GNode[]; edges: GEdge[]; total: number } {
  const { data, analysis: a, mode, metric, expanded } = input;
  const modeDef = MODES[mode];
  const { state } = a;
  const vById = Object.fromEntries(state.verticals.map((v) => [v.id, v]));
  const risks = bottlenecksByNode(a.bottlenecks);
  const collapseAll = !!modeDef.collapseAll;
  const colors = assignVerticalColors(state.verticals.map((v) => v.v));

  // ── Visibility ────────────────────────────────────────────────────────────
  const verticalVisible = (id: string) => !!vById[id]?.active && (!input.verticalFilter.size || input.verticalFilter.has(id) || id === NEW_VERTICAL_ID);
  const showSegments = !collapseAll && !input.hiddenKinds.has('segment') && (modeDef.showSegments || expanded.has(SEGMENT_CLUSTER));
  const showInfra = !collapseAll && !input.hiddenKinds.has('infra') && (modeDef.showInfra || expanded.has(INFRA_CLUSTER));
  const isExpanded = (vid: string) => !collapseAll && expanded.has(vid) && !input.hiddenKinds.has('product');

  const visibleVerticals = state.verticals.filter((v) => verticalVisible(v.id));
  const visibleProducts = data.products.filter((p) => state.products[p.id]?.active && verticalVisible(p.vertical) && isExpanded(p.vertical));
  const productVisible = new Set(visibleProducts.map((p) => p.id));
  const productVertical = Object.fromEntries(data.products.map((p) => [p.id, p.vertical]));
  /** Where a product's edges attach: itself if visible, otherwise its (collapsed) vertical. */
  const anchor = (productId: string) => (productVisible.has(productId) ? productId : verticalVisible(productVertical[productId]) ? productVertical[productId] : null);

  const layout = computeLayout(data, state, { expanded: new Set([...visibleVerticals.filter((v) => isExpanded(v.id)).map((v) => v.id)]), showSegments, showInfra, acquisition: input.acquisition });
  const pos = (id: string) => input.positions[id] ?? layout[id] ?? { x: 0, y: 0 };

  // ── Metric values ─────────────────────────────────────────────────────────
  const pairsOf = (vid: string) => data.pairs.filter((p) => p.a === vid || p.b === vid);
  const infraOf = (vid: string) => data.infra.filter((i) => i.dependents.includes(vid));
  const verticalMetric = (vid: string, m: FlowMetric): number => {
    const vs = vById[vid];
    if (!vs) return 0;
    switch (m) {
      case 'revenue': return vs.revenue;
      case 'profit': return Math.max(0, vs.ebitda);
      case 'customers': return vs.customers;
      case 'leads': return vs.v.ops.leadsPerMonth * 12;
      case 'crossSells': return sum(pairsOf(vid).map((p) => p.sharedCustomers)) + vs.components.crossSell / Math.max(vs.arpc, 1);
      case 'resources': return vs.revenue - vs.ebitda;
      case 'data': return sum(pairsOf(vid).map((p) => p.dataSharing)) * 100 + infraOf(vid).filter((i) => i.category === 'data' || i.category === 'ai').length * 50;
      case 'technology': return infraOf(vid).length * 10 + sum(pairsOf(vid).map((p) => p.sharedTech)) * 10;
      case 'employees': return vs.employees;
    }
  };
  const productMetric = (pid: string, m: FlowMetric): number => {
    const ps = state.products[pid];
    if (!ps) return 0;
    const vs = vById[ps.p.vertical];
    const share = vs?.revenue ? ps.revenue / vs.revenue : 0;
    switch (m) {
      case 'revenue': return ps.revenue;
      case 'profit': return Math.max(0, ps.profit);
      case 'customers': return ps.customers;
      case 'crossSells': return sum(data.affinities.filter((af) => af.a === pid || af.b === pid).map((af) => af.currentBoth));
      case 'resources': return ps.revenue * (1 - ps.p.margin);
      default: return verticalMetric(ps.p.vertical, m) * (m === 'leads' ? ps.p.attachRate : share);
    }
  };
  const segMetric = (sid: string, m: FlowMetric): number => {
    const s = state.segments.find((x) => x.id === sid);
    if (!s) return 0;
    if (m === 'customers') return s.customers;
    if (m === 'crossSells') return s.customers * s.s.crossSellPotential;
    if (m === 'leads') return s.customers * 0.2;
    if (m === 'profit') return sum(s.s.purchases.map((pu) => pu.revenue * (data.products.find((p) => p.id === pu.product)?.margin ?? 0.5) * 0.5));
    if (m === 'technology' || m === 'data') return s.verticals.length * 10;
    if (m === 'employees') return 0;
    return s.revenue;
  };

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const nodes: GNode[] = [];
  const statusNow: DataStatus = state.isProjected || (input.scenarioActive && state.scenarioApplied) ? 'projected' : 'actual';
  const opportunityOn = (id: string) => sum(a.opportunities.filter((o) => o.nodeIds.includes(id)).map((o) => o.revenue || o.profit));

  const sizeScale = (value: number, max: number, lo: number, hi: number) => lo + (hi - lo) * Math.sqrt(Math.max(0, value) / Math.max(max, 1e-9));
  const fmtMetric = (v: number, m: FlowMetric) => (['revenue', 'profit', 'resources'].includes(m) ? money(v) : num(v));

  const push = (id: string, d: Omit<NodeBase, 'dim' | 'highlight' | 'selected' | 'matched' | 'risk' | 'riskCount' | 'mode'>) => {
    const r = risks[id] ?? [];
    nodes.push({
      id, type: 'entity', position: pos(id), draggable: true, zIndex: d.kind === 'parent' ? 3 : d.kind === 'vertical' ? 2 : 1,
      data: { ...d, dim: false, highlight: false, selected: id === input.selectedId, matched: false, risk: riskScore(r) / 100, riskCount: r.length, mode },
    });
  };

  push('parent', {
    kind: 'parent', label: data.parent.name, sublabel: `${state.active.length} verticals · ${state.year}`,
    value: metric === 'revenue' ? state.revenue : metric === 'profit' ? state.ebitda : metric === 'customers' ? state.customers : metric === 'employees' ? state.employees : state.revenue,
    valueLabel: metric === 'customers' ? `${num(state.customers)} customers` : metric === 'employees' ? `${state.employees} people` : `${money(metric === 'profit' ? state.ebitda : state.revenue)} ${metric === 'profit' ? 'EBITDA' : 'revenue'}`,
    size: 168, color: KIND_COLOR.parent!, tint: 'rgba(242,235,221,0.12)', status: statusNow, ghost: false, opportunity: mode === 'growth' ? sum(a.opportunities.map((o) => o.revenue)) : 0,
    growth: state.prevRevenue ? state.growth : null, icon: 'Network',
  });

  const vMax = Math.max(...visibleVerticals.map((v) => verticalMetric(v.id, metric)), 1);
  for (const vs of visibleVerticals) {
    const val = verticalMetric(vs.id, metric);
    const hidden = data.products.filter((p) => p.vertical === vs.id && state.products[p.id]?.active).length;
    push(vs.id, {
      kind: 'vertical', label: vs.v.name, sublabel: `${pct(vs.growth, { sign: true })} · ${pct(vs.ebitdaMargin)} EBITDA`,
      value: val, valueLabel: fmtMetric(val, metric), size: sizeScale(val, vMax, 74, 142),
      color: colors[vs.id].base, tint: colors[vs.id].tint, hue: vs.v.hue, icon: vs.v.icon, verticalId: vs.id,
      status: vs.isNew ? 'user' : statusNow, ghost: vs.isNew, opportunity: mode === 'growth' ? opportunityOn(vs.id) + sum(data.products.filter((p) => p.vertical === vs.id).map((p) => opportunityOn(p.id))) : 0,
      growth: vs.prevRevenue ? vs.growth : null, count: hidden, expanded: isExpanded(vs.id),
      badge: !isExpanded(vs.id) && hidden ? `${hidden}` : undefined,
    });
  }

  const pMax = Math.max(...visibleProducts.map((p) => productMetric(p.id, metric)), 1);
  for (const p of visibleProducts) {
    const ps = state.products[p.id];
    const v = vById[p.vertical].v;
    const val = productMetric(p.id, metric);
    push(p.id, {
      kind: 'product', label: p.name, sublabel: `${pct(ps.growth, { sign: true })} · ${pct(p.margin)} GM${p.recurring ? ' · recurring' : ''}`,
      value: val, valueLabel: fmtMetric(val, metric), size: sizeScale(val, pMax, 30, 74),
      color: colors[p.vertical].light, tint: colors[p.vertical].tint, hue: v.hue, verticalId: p.vertical,
      status: statusNow, ghost: !!p.sunsetYear && state.year >= p.sunsetYear - 1, opportunity: mode === 'growth' ? opportunityOn(p.id) : 0,
      growth: ps.prevRevenue ? ps.growth : null,
    });
  }

  if (showSegments) {
    const sMax = Math.max(...state.segments.map((s) => segMetric(s.id, metric)), 1);
    for (const s of state.segments) {
      const val = segMetric(s.id, metric);
      push(s.id, {
        kind: 'segment', label: s.s.name, sublabel: `${num(s.customers)} customers · ${pct(s.share)} of revenue`,
        value: val, valueLabel: fmtMetric(val, metric), size: sizeScale(val, sMax, 44, 96),
        color: KIND_COLOR.segment!, tint: 'rgba(216,222,233,0.08)', icon: 'Users', status: statusNow, ghost: false,
        opportunity: mode === 'growth' ? opportunityOn(s.id) : 0, growth: null,
      });
    }
  } else if (!collapseAll && !input.hiddenKinds.has('segment') && data.segments.length) {
    push(SEGMENT_CLUSTER, { kind: 'cluster', label: 'Customer segments', sublabel: `${data.segments.length} segments · ${num(sum(state.segments.map((s) => s.customers)))} customers`, value: 0, valueLabel: 'Expand', size: 70, color: KIND_COLOR.segment!, tint: 'rgba(216,222,233,0.06)', icon: 'Users', status: statusNow, ghost: false, opportunity: 0, growth: null, count: data.segments.length, badge: `${data.segments.length}` });
  }

  if (showInfra) {
    const iVal = (i: (typeof data.infra)[number]) => (metric === 'data' ? i.dataRecords ?? i.dependents.length * 1e5 : metric === 'technology' ? i.dependents.length : i.annualCost);
    const iMax = Math.max(...data.infra.map(iVal), 1);
    for (const i of data.infra) {
      const deps = i.dependents.filter((d) => vById[d]?.active);
      if (!deps.length) continue;
      push(i.id, {
        kind: 'infra', label: i.name, sublabel: `${deps.length} dependent verticals · ${money(i.annualCost)}/yr`,
        value: iVal(i), valueLabel: metric === 'technology' ? `${deps.length} deps` : money(i.annualCost), size: sizeScale(iVal(i), iMax, 40, 70),
        color: KIND_COLOR.infra!, tint: 'rgba(127,163,184,0.12)', icon: 'Server', status: 'actual', ghost: false, opportunity: mode === 'growth' ? opportunityOn(i.id) : 0, growth: null,
      });
    }
    for (const f of data.functions) {
      push(f.id, {
        kind: 'function', label: f.name, sublabel: `${f.fte} FTE · ${pct(f.utilization)} utilized`, value: f.fte, valueLabel: `${f.fte} FTE`,
        size: 46, color: KIND_COLOR.function!, tint: 'rgba(154,163,174,0.1)', icon: 'UsersRound', status: 'actual', ghost: false, opportunity: 0, growth: null,
      });
    }
  } else if (!collapseAll && !input.hiddenKinds.has('infra') && data.infra.length) {
    push(INFRA_CLUSTER, { kind: 'cluster', label: 'Shared infrastructure', sublabel: `${data.infra.length} systems · ${data.functions.length} shared teams`, value: 0, valueLabel: 'Expand', size: 62, color: KIND_COLOR.infra!, tint: 'rgba(127,163,184,0.08)', icon: 'Server', status: 'actual', ghost: false, opportunity: 0, growth: null, count: data.infra.length + data.functions.length, badge: `${data.infra.length + data.functions.length}` });
  }

  if (input.acquisition) {
    const t = input.acquisition.input;
    push('acquisition', {
      kind: 'acquisition', label: t.name || 'Target', sublabel: `Fit ${input.acquisition.analysis.strategicFit} · ${money(t.price)} price`,
      value: t.revenue, valueLabel: money(t.revenue), size: sizeScale(t.revenue, vMax, 74, 142), color: KIND_COLOR.acquisition!, tint: 'rgba(255,209,102,0.1)',
      icon: 'Crosshair', status: 'user', ghost: true, opportunity: input.acquisition.analysis.revenueSynergy, growth: t.growth,
    });
  }

  const visible = new Set(nodes.map((n) => n.id));

  // ── Edges ─────────────────────────────────────────────────────────────────
  const raw: RawEdge[] = [];
  const add = (e: RawEdge) => {
    if (visible.has(e.source) && visible.has(e.target) && e.source !== e.target) raw.push(e);
  };

  for (const vs of visibleVerticals) add({ id: `own-${vs.id}`, source: vs.id, target: 'parent', kind: 'ownership', value: verticalMetric(vs.id, metric), strength: 0.5 });
  for (const p of visibleProducts) add({ id: `own-${p.id}`, source: p.id, target: p.vertical, kind: 'ownership', value: productMetric(p.id, metric), strength: 0.4 });
  if (!showSegments && visible.has(SEGMENT_CLUSTER)) add({ id: 'own-segc', source: SEGMENT_CLUSTER, target: 'parent', kind: 'revenue', value: state.revenue, strength: 0.3 });
  if (!showInfra && visible.has(INFRA_CLUSTER)) add({ id: 'own-infc', source: 'parent', target: INFRA_CLUSTER, kind: 'dependency', value: 1, strength: 0.25 });

  // Segment purchases — aggregated onto collapsed verticals. At scale (many products open) they
  // always aggregate to vertical level, otherwise hundreds of long edges bury the structure.
  if (showSegments) {
    const aggregateAll = visibleProducts.length > 150;
    for (const s of state.segments) {
      const agg: Record<string, number> = {};
      for (const pu of s.s.purchases) {
        const target = aggregateAll ? (verticalVisible(productVertical[pu.product]) ? productVertical[pu.product] : null) : anchor(pu.product);
        if (!target || !state.products[pu.product]?.active) continue;
        const ps = state.products[pu.product];
        const ref = ps.p.revenue[data.parent.currentYear] ?? ps.revenue;
        agg[target] = (agg[target] ?? 0) + pu.revenue * (ref ? ps.revenue / ref : 1);
      }
      for (const [target, value] of Object.entries(agg)) add({ id: `buy-${s.id}-${target}`, source: s.id, target, kind: 'revenue', value, strength: 0.4, label: money(value) + '/yr' });
    }
  }

  const synergyById = Object.fromEntries(a.synergies.map((s) => [`${s.a}__${s.b}`, s]));
  const topSynergy = new Set(a.synergies.slice(0, 3).map((s) => s.id));
  for (const p of data.pairs) {
    const syn = synergyById[`${p.a}__${p.b}`];
    if (!syn) continue;
    const key = `${p.a}-${p.b}`;
    if (p.revenueFlow) add({ id: `rf-${key}`, source: p.revenueFlow.from, target: p.revenueFlow.to, kind: 'revenue', value: p.revenueFlow.amount, strength: Math.min(1, p.revenueFlow.amount / 500_000), label: `${money(p.revenueFlow.amount)}/yr`, note: p.revenueFlow.note });
    if (mode === 'synergy') {
      add({ id: `syn-${key}`, source: p.a, target: p.b, kind: 'cross_sell', value: syn.score, strength: syn.score / 100, label: `${syn.score} · ${money(syn.incrementalRevenue)}`, forceLabel: syn.score >= 40, highlight: topSynergy.has(syn.id), note: `Synergy ${syn.score}/100 — ${syn.topDrivers.join(', ')}` });
    } else if (p.crossSellRevenue > 0) {
      add({ id: `cs-${key}`, source: p.a, target: p.b, kind: 'cross_sell', value: p.crossSellRevenue, strength: Math.min(1, p.currentCrossSellRate / 0.25), label: `${pct(p.currentCrossSellRate)} cross-sell`, note: `${money(p.crossSellRevenue)} from cross-sold customers` });
    }
    if (p.sharedCustomers > 0) add({ id: `co-${key}`, source: p.a, target: p.b, kind: 'customer_overlap', value: p.sharedCustomers, strength: Math.max(syn.overlapPctA, syn.overlapPctB), label: `${num(p.sharedCustomers)} shared (${pct(Math.max(syn.overlapPctA, syn.overlapPctB))})` });
    if (p.dependency) add({ id: `dep-${key}`, source: p.dependency.from, target: p.dependency.to, kind: 'dependency', value: 1, strength: 0.7, label: 'depends on', note: p.dependency.note });
    if (p.partnership) add({ id: `pt-${key}`, source: p.a, target: p.b, kind: 'partnership', value: 1, strength: 0.6, label: p.partnership });
    if (p.sharedInfra.length) add({ id: `si-${key}`, source: p.a, target: p.b, kind: 'shared_infra', value: p.sharedInfra.length, strength: Math.min(1, p.sharedInfra.length / 3), label: `${p.sharedInfra.length} shared systems` });
    if (p.sharedTech >= 0.4) add({ id: `st-${key}`, source: p.a, target: p.b, kind: 'shared_tech', value: p.sharedTech, strength: p.sharedTech, label: `tech ${pct(p.sharedTech)}` });
    if (p.sharedEmployeesFTE > 0) add({ id: `se-${key}`, source: p.a, target: p.b, kind: 'shared_employees', value: p.sharedEmployeesFTE, strength: Math.min(1, p.sharedEmployeesFTE / 5), label: `${p.sharedEmployeesFTE} shared FTE` });
    if (p.sharedMarketing >= 0.5) add({ id: `sm-${key}`, source: p.a, target: p.b, kind: 'shared_marketing', value: p.sharedMarketing, strength: p.sharedMarketing, label: 'shared marketing' });
    if (p.dataSharing >= 0.5) add({ id: `sd-${key}`, source: p.a, target: p.b, kind: 'shared_data', value: p.dataSharing, strength: p.dataSharing, label: `data ${pct(p.dataSharing)}` });
    if (p.distributionOverlap >= 0.5) add({ id: `sdist-${key}`, source: p.a, target: p.b, kind: 'shared_distribution', value: p.distributionOverlap, strength: p.distributionOverlap, label: 'shared distribution' });
  }

  for (const r of data.relations) {
    const s = anchor(r.source) ?? r.source, t = anchor(r.target) ?? r.target;
    add({ id: `rel-${r.id}`, source: s, target: t, kind: r.type, value: r.value ?? r.strength, strength: r.strength, label: r.label, note: r.note });
  }

  if (showInfra) {
    for (const i of data.infra) for (const d of i.dependents) add({ id: `dep-${i.id}-${d}`, source: d, target: i.id, kind: 'dependency', value: i.annualCost / i.dependents.length, strength: 0.3 + i.techDebt * 0.6, label: i.techDebt >= 0.5 ? `tech debt ${pct(i.techDebt)}` : undefined });
    for (const f of data.functions) for (const d of f.serves) add({ id: `fn-${f.id}-${d}`, source: f.id, target: d, kind: 'shared_employees', value: f.fte / f.serves.length, strength: Math.min(1, f.utilization), label: `${pct(f.utilization)} utilized` });
  }

  for (const o of a.offerPairs) {
    if (!productVisible.has(o.a.id) || !productVisible.has(o.b.id) || o.affinity < 0.6) continue;
    add({ id: `af-${o.id}`, source: o.a.id, target: o.b.id, kind: 'affinity', value: o.incrementalRevenue, strength: o.affinity, label: `+${money(o.incrementalRevenue)}`, note: `${pct(o.penetration)} of ${o.a.name} buyers also buy ${o.b.name}` });
  }

  if (input.journeyId) {
    const j = data.journeys.find((x) => x.id === input.journeyId);
    if (j) {
      const steps = j.steps.map((s) => (data.products.some((p) => p.id === s) ? anchor(s) : s)).filter((s, i, arr): s is string => !!s && s !== arr[i - 1]);
      for (let i = 0; i < steps.length - 1; i++) add({ id: `jr-${i}`, source: steps[i], target: steps[i + 1], kind: 'journey', value: j.revenue, strength: 1, label: i === 0 ? `${num(j.customers)} customers · ${money(j.revenue)}` : undefined, forceLabel: i === 0, highlight: true });
    }
  }

  if (input.acquisition) {
    for (const c of input.acquisition.analysis.connections) add({ id: `acq-${c.vertical}`, source: 'acquisition', target: c.vertical, kind: 'acquisition', value: c.strength, strength: c.strength, label: c.reasons.join(', ') || 'adjacent', forceLabel: c.strength > 0.3 });
  }

  // ── Mode / filter / focus treatment ──────────────────────────────────────
  const modeEdges = new Set<EdgeKind>([...modeDef.edges, 'journey', 'acquisition']);
  const flowKinds = new Set(METRIC_FLOW_EDGES[metric]);
  const edgesShown = raw.filter((e) => modeEdges.has(e.kind) && !input.hiddenEdges.has(e.kind));

  const neighbors = new Set<string>();
  if (input.focusId) {
    neighbors.add(input.focusId);
    for (const e of edgesShown) {
      if (e.source === input.focusId) neighbors.add(e.target);
      if (e.target === input.focusId) neighbors.add(e.source);
    }
  }
  const journeyNodes = new Set(edgesShown.filter((e) => e.kind === 'journey').flatMap((e) => [e.source, e.target]));
  const q = input.search.trim().toLowerCase();

  for (const n of nodes) {
    const d = n.data;
    d.matched = !!q && (d.label.toLowerCase().includes(q) || (d.kind === 'vertical' && data.products.some((p) => p.vertical === n.id && !productVisible.has(p.id) && p.name.toLowerCase().includes(q))));
    if (q) d.dim = !d.matched;
    if (journeyNodes.size) d.dim = !journeyNodes.has(n.id);
    if (input.focusId) {
      d.dim = !neighbors.has(n.id);
      d.highlight = n.id === input.focusId;
    }
    if (mode === 'risk' && !input.focusId && !q && n.id !== 'parent' && d.risk < 0.2 && d.kind !== 'cluster') d.dim = true;
    if (mode === 'growth' && !input.focusId && !q && d.kind !== 'parent' && d.opportunity <= 0 && d.kind !== 'acquisition') d.dim = true;
  }

  // Parallel edges between the same pair fan out so every relationship stays visible.
  const pairCount: Record<string, number> = {};
  const pairIndex: Record<string, number> = {};
  for (const e of edgesShown) { const k = [e.source, e.target].sort().join('|'); pairCount[k] = (pairCount[k] ?? 0) + 1; }
  const maxByKind: Record<string, number> = {};
  for (const e of edgesShown) maxByKind[e.kind] = Math.max(maxByKind[e.kind] ?? 0, e.value);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: GEdge[] = edgesShown.map((e) => {
    const k = [e.source, e.target].sort().join('|');
    const idx = (pairIndex[k] = (pairIndex[k] ?? -1) + 1);
    const n = pairCount[k];
    const dir = e.source < e.target ? 1 : -1; // keep offsets consistent regardless of direction
    const curvature = n > 1 ? (idx - (n - 1) / 2) * 0.22 * dir : e.kind === 'ownership' ? 0 : 0.12 * dir;
    const style = EDGE_STYLES[e.kind];
    const incident = !!input.focusId && (e.source === input.focusId || e.target === input.focusId);
    const flowing = (style.flow || flowKinds.has(e.kind)) && (e.kind !== 'ownership' || ['revenue', 'profit'].includes(metric));
    const rel = Math.sqrt(e.value / Math.max(maxByKind[e.kind] || 1, 1e-9));
    const dim = (!!input.focusId && !incident) || (!!q && !(nodeById.get(e.source)?.data.matched || nodeById.get(e.target)?.data.matched)) || (journeyNodes.size > 0 && e.kind !== 'journey') || (!!nodeById.get(e.source)?.data.dim && !!nodeById.get(e.target)?.data.dim);
    return {
      id: e.id, source: e.source, target: e.target, type: 'flow', zIndex: e.highlight || incident ? 1 : 0,
      data: {
        kind: e.kind, color: style.color, dash: style.dash, arrow: !!style.arrow, march: !!style.march,
        flow: flowing && !dim, particles: flowing ? 1 + Math.round(rel * 3) : 0, duration: 3.2 - rel * 1.6,
        width: e.kind === 'ownership' ? (flowing ? 1 + rel * 3 : 1) : 1 + e.strength * 3.2 + (e.highlight ? 1.5 : 0),
        strength: e.strength, label: e.label, showLabel: !!e.label && (incident || !!e.forceLabel), dim, highlight: !!e.highlight || incident,
        curvature, note: e.note,
      },
    };
  });

  const total = 1 + state.active.length + data.products.filter((p) => state.products[p.id]?.active).length + data.segments.length + data.infra.length + data.functions.length;
  return { nodes, edges, total };
}
