import type { CompanyData, Infra, Product, Segment, Vertical, VerticalPair } from '@/lib/domain/types';

/**
 * Deterministic synthetic company generator. Used to prove the graph stays usable at
 * 1,000+ nodes; totals are internally consistent (segments → products → verticals).
 */
export function generateCompany(opts: { id: string; name: string; verticals: number; productsPerVertical: number; segments: number; infra: number; seed: number }): CompanyData {
  let s = opts.seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const r2 = (v: number) => Math.round(v * 100) / 100;

  const VNAMES = ['Industrial Services', 'Healthcare', 'Logistics', 'Fintech', 'Hospitality', 'Education', 'Energy', 'Agritech', 'Security', 'Mobility', 'Insurance', 'Construction'];
  const HUES = [250, 300, 55, 150, 85, 25, 195, 120, 340, 270, 10, 220];
  const ICONS = ['Factory', 'HeartPulse', 'Truck', 'Landmark', 'Hotel', 'GraduationCap', 'Zap', 'Sprout', 'Shield', 'Car', 'Umbrella', 'HardHat'];
  const CAPS = ['acquisition', 'retention', 'content', 'brand', 'audience', 'strategy', 'commerce', 'distribution', 'property', 'data', 'platform', 'operations', 'finance'];
  const PREFIX = ['Core', 'Pro', 'Smart', 'Field', 'Cloud', 'Prime', 'Rapid', 'Managed', 'Guided', 'Open', 'Edge', 'Unified'];
  const NOUN = ['Suite', 'Service', 'Platform', 'Plan', 'Network', 'Desk', 'Hub', 'Studio', 'Program', 'Exchange', 'Ops', 'Kit'];
  const cur = 2026;

  const verticalIds = Array.from({ length: opts.verticals }, (_, i) => `v${i}`);
  const products: Product[] = [];
  verticalIds.forEach((vid, vi) => {
    for (let j = 0; j < opts.productsPerVertical; j++) {
      const growth = r2(between(-0.1, 0.45));
      products.push({
        id: `${vid}-p${j}`, vertical: vid,
        name: `${pick(PREFIX)} ${VNAMES[vi % VNAMES.length].split(' ')[0]} ${pick(NOUN)} ${j + 1}`,
        revenue: {}, atv: Math.round(between(80, 25000)), margin: r2(between(0.2, 0.85)), customers: 0,
        growth, repeatRate: r2(between(0.1, 0.95)), attachRate: r2(between(0.02, 0.6)), recurring: rnd() > 0.5,
        capabilities: [pick(CAPS), pick(CAPS)].filter((c, k, a) => a.indexOf(c) === k),
      });
    }
  });

  const segments: Segment[] = Array.from({ length: opts.segments }, (_, i) => {
    const purchases = Array.from({ length: Math.floor(between(6, 16)) }, () => ({ product: pick(products).id, revenue: Math.round(between(20_000, 900_000)) }))
      .filter((p, k, a) => a.findIndex((x) => x.product === p.product) === k);
    return {
      id: `seg${i}`, name: `Segment ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`, description: 'Generated customer segment',
      customers: Math.round(between(20, 4000)), revenue: purchases.reduce((a, p) => a + p.revenue, 0),
      retention: r2(between(0.5, 0.95)), crossSellPotential: r2(between(0.2, 0.9)), purchases, b2b: rnd() > 0.2,
    };
  });

  // Product revenue = what segments buy (plus a floor so every product exists).
  for (const p of products) {
    const now = segments.flatMap((sg) => sg.purchases).filter((pu) => pu.product === p.id).reduce((a, pu) => a + pu.revenue, 0) || Math.round(between(15_000, 120_000));
    p.revenue = { 2024: Math.round(now / (1 + p.growth) ** 2), 2025: Math.round(now / (1 + p.growth)), [cur]: now };
    p.customers = Math.max(3, Math.round(now / Math.max(p.atv, 500)));
  }

  const verticals: Vertical[] = verticalIds.map((vid, i) => {
    const ps = products.filter((p) => p.vertical === vid);
    const series = (y: number) => ps.reduce((a, p) => a + (p.revenue[y] ?? 0), 0);
    const now = series(cur);
    const customers = ps.reduce((a, p) => a + p.customers, 0);
    return {
      id: vid, name: VNAMES[i % VNAMES.length], hue: HUES[i % HUES.length], icon: ICONS[i % ICONS.length],
      description: 'Generated vertical', revenue: { 2024: series(2024), 2025: series(2025), [cur]: now },
      projectedGrowth: r2(between(0.03, 0.3)), grossMargin: r2(between(0.3, 0.8)), ebitdaMargin: r2(between(0.02, 0.3)),
      contributionMargin: r2(between(0.15, 0.5)), customers, employees: Math.round(now / between(120_000, 300_000)),
      recurringShare: r2(between(0.1, 0.9)), cac: Math.round(between(200, 8000)), ltv: Math.round(between(2000, 90000)),
      retention: r2(between(0.55, 0.93)), tam: Math.round(between(1, 40)) * 1e9, sam: Math.round(between(50, 900)) * 1e6,
      strategicImportance: Math.round(between(3, 10)), growthPotential: Math.round(between(3, 10)),
      marketingSpend: Math.round(now * between(0.02, 0.1)), requiredInvestment: Math.round(between(100_000, 2_000_000)), b2b: rnd() > 0.2,
      ops: { leadsPerMonth: Math.round(between(20, 900)), leadsNeeded: Math.round(between(20, 1000)), utilization: r2(between(0.55, 0.98)), keyPersonRisk: r2(between(0.1, 0.9)), topCustomerShare: r2(between(0.01, 0.3)) },
      risks: ['Generated risk'],
    };
  });

  const infraCats: Infra['category'][] = ['crm', 'web', 'data', 'ai', 'payments', 'distribution', 'location', 'other'];
  const infra: Infra[] = Array.from({ length: opts.infra }, (_, i) => ({
    id: `inf${i}`, name: `${pick(['Shared', 'Central', 'Group', 'Regional'])} ${infraCats[i % infraCats.length].toUpperCase()} ${i + 1}`,
    category: infraCats[i % infraCats.length], annualCost: Math.round(between(40_000, 600_000)), techDebt: r2(between(0.05, 0.9)),
    dependents: verticalIds.filter(() => rnd() > 0.6),
  }));

  const pairs: VerticalPair[] = [];
  for (let a = 0; a < verticalIds.length; a++) {
    for (let b = a + 1; b < verticalIds.length; b++) {
      if (rnd() < 0.45) continue;
      const cur = r2(between(0.01, 0.2));
      pairs.push({
        a: verticalIds[a], b: verticalIds[b], sharedCustomers: Math.round(between(5, 400)),
        eligibleAtoB: Math.round(between(20, 1500)), eligibleBtoA: Math.round(between(20, 1500)),
        currentCrossSellRate: cur, targetCrossSellRate: r2(cur + between(0.03, 0.2)), crossSellRevenue: Math.round(between(10_000, 700_000)),
        sharedInfra: infra.filter((i) => i.dependents.includes(verticalIds[a]) && i.dependents.includes(verticalIds[b])).slice(0, 4).map((i) => i.id),
        sharedEmployeesFTE: Math.round(between(0, 6)), sharedTech: r2(rnd()), sharedMarketing: r2(rnd()), dataSharing: r2(rnd()), distributionOverlap: r2(rnd()),
      });
    }
  }

  const affinities = Array.from({ length: products.length }, () => {
    const a = pick(products), b = pick(products);
    return { a: a.id, b: b.id, affinity: r2(between(0.3, 0.95)), currentBoth: Math.round(between(1, 60)) };
  }).filter((x, k, arr) => x.a !== x.b && arr.findIndex((y) => (y.a === x.a && y.b === x.b) || (y.a === x.b && y.b === x.a)) === k);

  const total = verticals.reduce((a, v) => a + v.revenue[cur], 0);
  return {
    meta: { id: opts.id, name: opts.name, currency: 'USD', asOf: '2026-09-30', source: 'generated', description: `Synthetic dataset with ${verticals.length + products.length + segments.length + infra.length + 1} nodes for scale testing.` },
    parent: {
      id: 'parent', name: opts.name.replace(/ \(.*\)$/, ''), tagline: 'Synthetic multi-vertical group', currentYear: cur, years: [2024, 2025, 2026, 2027, 2028],
      cash: Math.round(total * 0.08), monthlyOpex: Math.round((total * 0.85) / 12), workingCapitalMonths: 3.4, debt: Math.round(total * 0.2), topCustomerShare: 0.03,
      markets: ['North America', 'Europe'],
    },
    verticals, products, segments, infra,
    functions: [
      { id: 'fn-shared-sales', name: 'Group Sales', fte: 40, annualCost: 4_200_000, serves: verticalIds.slice(0, 6), utilization: 0.9, keyPersonRisk: 0.3 },
      { id: 'fn-shared-ops', name: 'Group Operations', fte: 28, annualCost: 2_900_000, serves: verticalIds, utilization: 0.82, keyPersonRisk: 0.5 },
    ],
    pairs, affinities, journeys: [], relations: [],
  };
}
