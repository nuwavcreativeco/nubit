import type { CompanyData, ScenarioParams } from '@/lib/domain/types';
import type { FullAnalysis } from './index';
import { computeState } from './model';
import { sum } from './format';

export interface PotentialDriver {
  label: string;
  amount: number;
  confidence: number;
  kind: 'organic' | 'opportunity';
}

export interface PotentialState {
  current: number;
  potential: number;
  riskAdjusted: number;
  drivers: PotentialDriver[];
}

/**
 * Current vs. potential revenue for any node: two years of base-case organic growth plus every
 * identified opportunity that touches the node (shared opportunities are split evenly).
 */
export function potentialFor(nodeId: string, data: CompanyData, a: FullAnalysis, baseline: ScenarioParams): PotentialState | null {
  const { state } = a;
  const horizon = state.year + 2;
  const future = computeState(data, horizon, baseline, baseline);

  const vertical = state.verticals.find((v) => v.id === nodeId);
  const product = state.products[nodeId];
  const segment = state.segments.find((s) => s.id === nodeId);
  const isParent = nodeId === 'parent';
  const current = isParent ? state.revenue : vertical?.revenue ?? product?.revenue ?? segment?.revenue;
  if (current === undefined) return null;

  const ownProducts = new Set(data.products.filter((p) => p.vertical === nodeId).map((p) => p.id));
  const touches = (ids: string[]) => isParent || ids.includes(nodeId) || (!!vertical && ids.some((id) => ownProducts.has(id)));

  const drivers: PotentialDriver[] = [];
  let organic = 0;
  if (isParent) organic = future.revenue - state.baseRevenue;
  else if (vertical) organic = (future.verticals.find((v) => v.id === nodeId)?.baseRevenue ?? 0) - vertical.baseRevenue;
  else if (product) organic = (future.products[nodeId]?.baseRevenue ?? 0) - product.baseRevenue;
  else if (segment) organic = (future.segments.find((s) => s.id === nodeId)?.revenue ?? 0) - segment.revenue;
  if (organic > 0) drivers.push({ label: `Base-case organic growth to ${horizon}`, amount: organic, confidence: 0.7, kind: 'organic' });

  for (const o of a.opportunities) {
    if (!touches(o.nodeIds) || o.revenue <= 0) continue;
    const share = isParent ? 1 : 1 / Math.max(1, o.nodeIds.length);
    drivers.push({ label: o.name, amount: o.revenue * share, confidence: o.confidence, kind: 'opportunity' });
  }
  drivers.sort((x, y) => y.amount - x.amount);

  return {
    current,
    potential: current + sum(drivers.map((d) => d.amount)),
    riskAdjusted: current + sum(drivers.map((d) => d.amount * d.confidence)),
    drivers,
  };
}
