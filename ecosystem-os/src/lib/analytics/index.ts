import type { CompanyData, ScenarioParams } from '@/lib/domain/types';
import { computeState, valuation } from './model';
import { computeSynergies } from './synergy';
import { detectBottlenecks } from './bottlenecks';
import { computeHealth } from './health';
import { computeBundles, computeOfferPairs } from './overlap';
import { findOpportunities } from './opportunities';

export function analyze(data: CompanyData, year: number, scenario: ScenarioParams, baseline: ScenarioParams) {
  const state = computeState(data, year, scenario, baseline);
  const synergies = computeSynergies(data, state);
  const bottlenecks = detectBottlenecks(data, state);
  const health = computeHealth(data, state, bottlenecks);
  const offerPairs = computeOfferPairs(data, state);
  const bundles = computeBundles(data, state);
  const opportunities = findOpportunities(data, state, synergies, bundles);
  const val = valuation(state, health.score);
  return { state, synergies, bottlenecks, health, offerPairs, bundles, opportunities, valuation: val };
}

export type FullAnalysis = ReturnType<typeof analyze>;
