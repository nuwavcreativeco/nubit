import type { DataStatus, FieldStatus } from './types';

export const STATUS_LABEL: Record<DataStatus, string> = {
  actual: 'Actual',
  estimated: 'Estimated',
  projected: 'Projected',
  ai: 'AI generated',
  user: 'User input',
};

export const STATUS_HINT: Record<DataStatus, string> = {
  actual: 'Reported figure from the source system for a closed or current period.',
  estimated: 'Management estimate or model-derived value (e.g. market size, synergy). Not a reported figure.',
  projected: 'Forward-looking: a future period, or the current period under a what-if scenario.',
  ai: 'Written by the AI analyst. Numbers it cites come from the engine; its interpretation does not.',
  user: 'Entered by you in a scenario or acquisition model.',
};

// Inputs that are inherently assumptions, even when they come from the source system.
const ESTIMATED_FIELDS = new Set([
  'tam', 'sam', 'strategicImportance', 'growthPotential', 'requiredInvestment', 'projectedGrowth',
  'contributionMargin', 'crossSellPotential', 'targetCrossSellRate', 'eligibleAtoB', 'eligibleBtoA',
  'affinity', 'sharedTech', 'sharedMarketing', 'dataSharing', 'distributionOverlap', 'techDebt',
  'keyPersonRisk', 'expansion', 'externalizable', 'supplyChain', 'ltv',
]);

export interface StatusContext {
  isProjected: boolean; // viewing a future year
  scenarioActive: boolean; // current-year values altered by a what-if
}

/** Resolve the status for a raw input field. Explicit per-entity overrides win. */
export function fieldStatus(field: string, ctx: StatusContext, overrides?: FieldStatus): DataStatus {
  if (overrides?.[field]) return overrides[field]!;
  if (ESTIMATED_FIELDS.has(field)) return 'estimated';
  if (ctx.isProjected || ctx.scenarioActive) return 'projected';
  return 'actual';
}

/** Status for a period-based measured value (revenue, EBITDA, customers…). */
export const periodStatus = (ctx: StatusContext): DataStatus => (ctx.isProjected || ctx.scenarioActive ? 'projected' : 'actual');
