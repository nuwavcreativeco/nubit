import type { CompanyData, Product } from '@/lib/domain/types';
import type { CompanyState } from './model';
import { avg, clamp, sum } from './format';

export interface OfferPair {
  id: string;
  a: Product;
  b: Product;
  affinity: number;
  crossVertical: boolean;
  customersA: number;
  customersB: number;
  currentBoth: number;
  penetration: number; // share of A customers already buying B
  customerOverlap: number; // both / smaller base
  crossSellPct: number;
  adoption: number; // estimated adoption among non-buyers
  newCustomers: number;
  incrementalRevenue: number;
  incrementalMargin: number;
  strategicValue: number; // 0-100
}

export interface Bundle {
  id: string;
  name: string;
  theme: string;
  members: Product[];
  verticals: string[];
  avgAffinity: number;
  currentAll: number; // customers already buying every component
  addressable: number;
  adoption: number;
  newCustomers: number;
  price: number; // annual bundle price
  incrementalRevenue: number;
  incrementalMargin: number;
  margin: number;
  strategicValue: number;
}

const THEMES: Record<string, string> = {
  acquisition: 'Full Customer Acquisition System',
  retention: 'Client Retention OS',
  content: 'Brand & Content Engine',
  brand: 'Brand & Content Engine',
  audience: 'Audience Monetization Package',
  strategy: 'Strategy-to-Execution Program',
  commerce: 'Commerce Growth Stack',
  distribution: 'Commerce Growth Stack',
  property: 'Founder Workspace Bundle',
  data: 'Intelligence Suite',
  platform: 'Digital Platform Bundle',
  operations: 'Operations Autopilot',
  finance: 'Exit-Readiness Package',
  production: 'Artist Release Package',
};

/** Annual revenue per customer for a product in the selected year. */
const annualValue = (state: CompanyState, p: Product) => {
  const s = state.products[p.id];
  return s && s.customers ? s.revenue / s.customers : 0;
};

export function computeOfferPairs(data: CompanyData, state: CompanyState): OfferPair[] {
  const byId = Object.fromEntries(data.products.map((p) => [p.id, p]));
  return data.affinities
    .filter((af) => state.products[af.a]?.active && state.products[af.b]?.active)
    .map((af) => {
      const a = byId[af.a], b = byId[af.b];
      const ca = state.products[a.id].customers, cb = state.products[b.id].customers;
      const both = Math.min(af.currentBoth, ca, cb);
      const adoption = clamp(af.affinity * 0.2, 0.02, 0.3);
      const newAB = (ca - both) * adoption;
      const newBA = (cb - both) * adoption * 0.5; // the reverse direction converts at roughly half the rate
      // A cross-sold customer's spend is bounded by what they already spend with us.
      const crossValue = (from: Product, to: Product) => Math.min(annualValue(state, to), Math.max(annualValue(state, from) * 4, 5000));
      const rev = newAB * crossValue(a, b) * 0.6 + newBA * crossValue(b, a) * 0.6;
      const margin = (newAB * b.margin + newBA * a.margin) / Math.max(newAB + newBA, 1);
      const crossVertical = a.vertical !== b.vertical;
      return {
        id: `${a.id}__${b.id}`, a, b, affinity: af.affinity, crossVertical,
        customersA: ca, customersB: cb, currentBoth: both,
        penetration: ca ? both / ca : 0,
        customerOverlap: both / Math.max(1, Math.min(ca, cb)),
        crossSellPct: (ca + cb) ? (2 * both) / (ca + cb) : 0,
        adoption,
        newCustomers: Math.round(newAB + newBA),
        incrementalRevenue: rev,
        incrementalMargin: rev * margin,
        strategicValue: Math.round(clamp(af.affinity * 50 + (crossVertical ? 20 : 0) + (b.recurring ? 15 : 5) + b.margin * 15, 0, 100)),
      };
    })
    .sort((x, y) => y.incrementalRevenue - x.incrementalRevenue);
}

/** Finds groups of products where every pair has high affinity (cliques), then prices them as bundles. */
export function computeBundles(data: CompanyData, state: CompanyState, threshold = 0.65): Bundle[] {
  const active = data.products.filter((p) => state.products[p.id]?.active);
  const ids = new Set(active.map((p) => p.id));
  const adj: Record<string, Map<string, { affinity: number; both: number }>> = {};
  for (const af of data.affinities) {
    if (af.affinity < threshold || !ids.has(af.a) || !ids.has(af.b)) continue;
    (adj[af.a] ??= new Map()).set(af.b, { affinity: af.affinity, both: af.currentBoth });
    (adj[af.b] ??= new Map()).set(af.a, { affinity: af.affinity, both: af.currentBoth });
  }

  // Bron–Kerbosch: the product graph is small, so exhaustive search is fine.
  const cliques: string[][] = [];
  const bk = (r: string[], p: string[], x: string[]) => {
    if (!p.length && !x.length) { if (r.length >= 3) cliques.push(r); return; }
    for (const v of [...p]) {
      const n = adj[v] ?? new Map();
      bk([...r, v], p.filter((u) => n.has(u)), x.filter((u) => n.has(u)));
      p = p.filter((u) => u !== v);
      x = [...x, v];
    }
  };
  bk([], Object.keys(adj), []);

  const byId = Object.fromEntries(active.map((p) => [p.id, p]));
  const seenNames = new Map<string, number>();
  return cliques
    .map((ids) => {
      const members = ids.map((id) => byId[id]);
      const tagCount: Record<string, number> = {};
      members.forEach((m) => m.capabilities.forEach((c) => (tagCount[c] = (tagCount[c] ?? 0) + 1)));
      const theme = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0][0];
      const links: { affinity: number; both: number }[] = [];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) links.push(adj[ids[i]].get(ids[j])!);
      const avgAffinity = avg(links.map((l) => l.affinity));
      const currentAll = Math.min(...links.map((l) => l.both));
      const anchor = members.reduce((best, m) => (state.products[m.id].customers > state.products[best.id].customers ? m : best));
      const values = members.map((m) => annualValue(state, m));
      const price = sum(values) * 0.85; // 15% bundle discount
      const addressable = state.products[anchor.id].customers - currentAll;
      const adoption = clamp(avgAffinity * 0.18, 0.03, 0.25);
      const newCustomers = Math.round(addressable * adoption);
      // Buyers already pay for the anchor product; the bundle adds the rest at a discount.
      const incrementalRevenue = newCustomers * Math.max(0, price - annualValue(state, anchor)) * 0.7;
      const margin = sum(members.map((m, i) => m.margin * values[i])) / Math.max(1, sum(values));
      const verticals = [...new Set(members.map((m) => m.vertical))];
      return {
        id: ids.sort().join('+'), theme, members, verticals, avgAffinity, currentAll, addressable, adoption, newCustomers,
        price, incrementalRevenue, incrementalMargin: incrementalRevenue * margin, margin, name: '',
        strategicValue: Math.round(clamp(avgAffinity * 45 + verticals.length * 12 + members.filter((m) => m.recurring).length * 6, 0, 100)),
      } as Bundle;
    })
    .sort((a, b) => b.incrementalRevenue - a.incrementalRevenue)
    .map((b) => {
      const base = THEMES[b.theme] ?? 'Integrated Offer';
      const n = (seenNames.get(base) ?? 0) + 1;
      seenNames.set(base, n);
      return { ...b, name: n === 1 ? base : `${base} ${['', '', 'II', 'III', 'IV'][n] ?? n}` };
    });
}
