import type { AcquisitionInput, CompanyData } from '@/lib/domain/types';
import type { CompanyState } from './model';
import { clamp, sum } from './format';

export interface AcquisitionAnalysis {
  serviceOverlap: number;
  customerOverlap: number;
  geographicOverlap: number;
  infraOverlap: number;
  crossSellPotential: number;
  revenueSynergy: number;
  costSynergy: number;
  strategicFit: number; // 0-100
  synergyScore: number; // 0-100
  integrationRisk: number; // 0-100, higher = riskier
  integrationComplexity: 'Low' | 'Medium' | 'High';
  evEbitda: number;
  paybackYears: number;
  connections: { vertical: string; strength: number; reasons: string[] }[];
  verdict: string;
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
};

export const ALL_CAPABILITIES = ['acquisition', 'retention', 'content', 'brand', 'audience', 'strategy', 'commerce', 'distribution', 'property', 'data', 'platform', 'operations', 'finance', 'production'];
export const INFRA_CATEGORIES = ['crm', 'web', 'data', 'ai', 'payments', 'distribution', 'location'];

export function analyzeAcquisition(data: CompanyData, state: CompanyState, t: AcquisitionInput): AcquisitionAnalysis {
  const activeProducts = data.products.filter((p) => state.products[p.id]?.active);
  const companyCaps = new Set(activeProducts.flatMap((p) => p.capabilities));
  const targetCaps = new Set(t.services);
  const serviceOverlap = targetCaps.size ? [...targetCaps].filter((c) => companyCaps.has(c)).length / targetCaps.size : 0;

  const segShare = sum(state.segments.filter((s) => t.segments.includes(s.id)).map((s) => s.share));
  const customerOverlap = clamp(segShare * 1.3);
  const geographicOverlap = t.geography.length ? t.geography.filter((g) => data.parent.markets.some((m) => m.toLowerCase() === g.toLowerCase())).length / t.geography.length : 0;
  const companyInfra = new Set<string>(data.infra.map((i) => i.category));
  const infraOverlap = t.infra.length ? t.infra.filter((c) => companyInfra.has(c)).length / t.infra.length : 0;

  // Which existing verticals the target would plug into, and why.
  const connections = state.active
    .filter((v) => !v.isNew)
    .map((v) => {
      const caps = new Set(data.products.filter((p) => p.vertical === v.id).flatMap((p) => p.capabilities));
      const capFit = jaccard(caps, targetCaps);
      const segFit = state.segments.filter((s) => t.segments.includes(s.id) && s.verticals.includes(v.id)).length / Math.max(1, t.segments.length);
      const infraFit = data.infra.filter((i) => i.dependents.includes(v.id) && t.infra.includes(i.category)).length / Math.max(1, t.infra.length);
      const reasons = [
        capFit > 0.15 && 'overlapping services',
        segFit > 0.3 && 'shared customers',
        infraFit > 0.3 && 'shared infrastructure',
      ].filter(Boolean) as string[];
      return { vertical: v.id, strength: clamp(capFit * 0.45 + segFit * 0.35 + infraFit * 0.2), reasons };
    })
    .filter((c) => c.strength > 0.08)
    .sort((a, b) => b.strength - a.strength);

  // Cross-sell: target customers × adjacency × average ticket of the connected verticals, plus the reverse.
  const adjacency = clamp(sum(connections.slice(0, 3).map((c) => c.strength)) / 1.5);
  const crossSellPotential = clamp(adjacency * 0.6 + customerOverlap * 0.4);
  // Only customers in the segments the target actually serves are realistic cross-sell candidates.
  const shared = state.segments.filter((s) => t.segments.includes(s.id));
  const sharedCustomers = sum(shared.map((s) => s.customers));
  const sharedArpc = sharedCustomers ? sum(shared.map((s) => s.revenue)) / sharedCustomers : state.revenue / Math.max(1, state.customers);
  const targetArpc = t.revenue / Math.max(1, t.customers);
  const revenueSynergy = (t.customers * crossSellPotential * 0.08 * Math.min(sharedArpc, 20000) + sharedCustomers * crossSellPotential * 0.03 * Math.min(targetArpc, 20000)) * 0.6;

  const targetOpex = Math.max(0, t.revenue - t.ebitda);
  const costSynergy = targetOpex * (0.03 + infraOverlap * 0.05 + serviceOverlap * 0.04 + geographicOverlap * 0.03);

  const sizeRatio = t.revenue / Math.max(1, state.revenue);
  const strategicFit = Math.round(100 * clamp(serviceOverlap * 0.25 + customerOverlap * 0.25 + adjacency * 0.2 + infraOverlap * 0.1 + clamp(t.growth / 0.3) * 0.2));
  const synergyScore = Math.round(100 * clamp((revenueSynergy + costSynergy * 2) / Math.max(1, t.revenue * 0.5)));
  const integrationRisk = Math.round(100 * clamp(clamp(sizeRatio * 1.5) * 0.35 + (1 - geographicOverlap) * 0.2 + (1 - infraOverlap) * 0.2 + (1 - serviceOverlap) * 0.15 + clamp(t.employees / 150) * 0.1));
  const evEbitda = t.ebitda > 0 ? t.price / t.ebitda : Infinity;
  const annualGain = t.ebitda + costSynergy + revenueSynergy * 0.35;
  const paybackYears = annualGain > 0 ? t.price / annualGain : Infinity;

  const verdict =
    strategicFit >= 65 && integrationRisk < 50 && evEbitda < 8 ? 'Strong fit — pursue with confirmatory diligence.'
    : strategicFit >= 50 && evEbitda < 10 ? 'Reasonable fit — negotiate price or structure an earn-out against synergies.'
    : strategicFit < 40 ? 'Weak strategic fit — value would rely on stand-alone performance.'
    : 'Mixed — synergies exist but price or integration risk erode the case.';

  return {
    serviceOverlap, customerOverlap, geographicOverlap, infraOverlap, crossSellPotential,
    revenueSynergy, costSynergy, strategicFit, synergyScore, integrationRisk,
    integrationComplexity: integrationRisk < 35 ? 'Low' : integrationRisk < 60 ? 'Medium' : 'High',
    evEbitda, paybackYears, connections, verdict,
  };
}
