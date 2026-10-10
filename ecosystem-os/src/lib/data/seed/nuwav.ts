import type { CompanyData } from '@/lib/domain/types';

const K = 1_000;

// NuWav — built from an owner interview on 2026-10-08.
// Figures the owner gave are left as reported ("actual"). Anything inferred to complete the model is
// flagged "estimated" via `status` so it shows as EST in the product and can be corrected later.
//
// Reported:
//   Music  ≈ $80K in 2024, 2025, expected 2026 — 40% recording, 40% music videos, 15% beats, 5% mixes;
//          ~200 artists/yr, 20% repeat; ~50% of revenue goes to costs.
//   World  ≈ $1K in 2024, 2025, expected 2026; artists buy the clothing more often than agency services.
//   Creative Co — billing since ~Aug 2026; MRR today $3,579 = 1 video retainer at $1,500 (discounted
//          from $2,000) + 7 systems clients at $297; target $8K+ MRR by year-end; no setup fees;
//          one website developer paid $180 flat per account; GoHighLevel used by owner + developer;
//          the same video gear/skill powers Music videos and the video retainer; Creative runs
//          marketing for Music but not World.
//   Plan — scale the agency with marketing campaigns; once cash flow is 7 figures, bring marketing
//          back to Music, productize and scale.
//
// Market sizes (all EST) are the Puget Sound market NuWav can reach today, not global industry totals:
//   Music  TAM $30M  regional spend by independent artists on recording, video, beats and mixing;
//          SAM $3M   artists within reach of one studio and its network.
//   Creative Co TAM $450M  ~150K local small businesses × ~$3K/yr outsourced marketing;
//          SAM $20M  service businesses that buy CRM/automation systems or video retainers.
//   World  TAM $5M   streetwear bought by the local music scene; SAM $0.5M  NuWav's own artist/fan community.
const EST = 'estimated' as const;

export const nuwav: CompanyData = {
  meta: {
    id: 'nuwav',
    name: 'NuWav',
    currency: 'USD',
    asOf: '2026-10-08',
    source: 'interview',
    description: 'Owner interview, Oct 2026. Reported figures are marked ACT; inferred ones EST — correct them on the Your numbers page.',
  },
  parent: {
    id: 'parent',
    name: 'NuWav',
    tagline: 'Music, marketing and apparel under one roof',
    currentYear: 2026,
    years: [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032],
    cash: 13 * K,
    monthlyOpex: 4.3 * K,
    workingCapitalMonths: 3,
    debt: 0,
    topCustomerShare: 0.09, // the $1,500/mo video retainer ≈ $9.7K of ~$104K 2026 revenue
    markets: ['Seattle', 'Online (US)'],
    status: { cash: EST, monthlyOpex: EST, workingCapitalMonths: EST, debt: EST },
  },

  verticals: [
    {
      id: 'music', name: 'NuWav Music', hue: 285, icon: 'Music',
      description: 'Studio recording, music videos, beat production and mixing for independent artists.',
      revenue: { 2024: 80 * K, 2025: 80 * K, 2026: 80 * K }, projectedGrowth: 0.03,
      grossMargin: 0.6, ebitdaMargin: 0.5, contributionMargin: 0.5,
      customers: 200, employees: 0, recurringShare: 0, cac: 40, ltv: 325, retention: 0.2,
      tam: 30_000_000, sam: 3_000_000, strategicImportance: 8, growthPotential: 6,
      marketingSpend: 2 * K, requiredInvestment: 25 * K, b2b: true,
      ops: { leadsPerMonth: 25, leadsNeeded: 25, utilization: 0.6, keyPersonRisk: 0.9, topCustomerShare: 0.03 },
      risks: ['Revenue flat for three years', 'Owner delivers most sessions and videos', 'Only 20% of artists come back'],
      status: { leadsPerMonth: EST, leadsNeeded: EST, utilization: EST, grossMargin: EST, cac: EST, ltv: EST, tam: EST, sam: EST, marketingSpend: EST, requiredInvestment: EST },
    },
    {
      id: 'creative', name: 'NuWav Creative Co', hue: 255, icon: 'Megaphone', launchYear: 2026,
      description: 'Marketing agency: systems & automations (CRM, AI agent, website) and a video + social + Meta ads retainer.',
      // 2026 ≈ Aug–Oct actual billing + Nov–Dec ramp to the $8K MRR target; 2027 holds that run-rate.
      revenue: { 2026: 23 * K, 2027: 96 * K }, projectedGrowth: 0.5,
      grossMargin: 0.75, ebitdaMargin: 0.5, contributionMargin: 0.35, // scaling means hiring: new revenue earns less than today's lean margin
      customers: 8, employees: 0, recurringShare: 1, cac: 300, ltv: 27 * K, retention: 0.85,
      tam: 450_000_000, sam: 20_000_000, strategicImportance: 10, growthPotential: 10,
      marketingSpend: 3 * K, requiredInvestment: 15 * K, b2b: true,
      ops: { leadsPerMonth: 10, leadsNeeded: 30, utilization: 0.7, keyPersonRisk: 0.85, topCustomerShare: 0.42 },
      risks: ['One client is 42% of MRR', 'Owner sells and manages every account', 'Single developer builds every website'],
      status: { leadsPerMonth: EST, leadsNeeded: EST, utilization: EST, revenue: EST, grossMargin: EST, contributionMargin: EST, cac: EST, ltv: EST, retention: EST, tam: EST, sam: EST, marketingSpend: EST, requiredInvestment: EST },
    },
    {
      id: 'world', name: 'NuWav World', hue: 150, icon: 'Shirt',
      description: 'Clothing brand sold online.',
      revenue: { 2024: 1 * K, 2025: 1 * K, 2026: 1 * K }, projectedGrowth: 0,
      grossMargin: 0.5, ebitdaMargin: 0.4, contributionMargin: 0.45,
      customers: 25, employees: 0, recurringShare: 0, cac: 20, ltv: 30, retention: 0.2,
      tam: 5_000_000, sam: 500_000, strategicImportance: 4, growthPotential: 5,
      marketingSpend: 0, requiredInvestment: 3 * K, b2b: false,
      ops: { leadsPerMonth: 50, leadsNeeded: 100, utilization: 0.1, keyPersonRisk: 0.9, topCustomerShare: 0.1 },
      risks: ['No marketing support today', 'Sales depend on the studio\'s artists'],
      status: { leadsPerMonth: EST, leadsNeeded: EST, utilization: EST, grossMargin: EST, ebitdaMargin: EST, customers: EST, cac: EST, ltv: EST, retention: EST, tam: EST, sam: EST, requiredInvestment: EST },
    },
  ],

  products: [
    { id: 'mu-recording', vertical: 'music', name: 'Studio Recording', revenue: { 2024: 32 * K, 2025: 32 * K, 2026: 32 * K }, atv: 230, margin: 0.6, customers: 140, growth: 0, repeatRate: 0.2, attachRate: 0.7, recurring: false, capabilities: ['production', 'content'], upsell: { to: 'Recording + Mix & Master package', priceUplift: 150, rate: 0.25 }, status: { customers: EST, atv: EST, margin: EST } },
    { id: 'mu-videos', vertical: 'music', name: 'Music Videos', revenue: { 2024: 32 * K, 2025: 32 * K, 2026: 32 * K }, atv: 800, margin: 0.5, customers: 40, growth: 0, repeatRate: 0.2, attachRate: 0.2, recurring: false, capabilities: ['production', 'content', 'brand'], status: { customers: EST, atv: EST, margin: EST } },
    { id: 'mu-beats', vertical: 'music', name: 'Beat Sales', revenue: { 2024: 12 * K, 2025: 12 * K, 2026: 12 * K }, atv: 150, margin: 0.85, customers: 80, growth: 0, repeatRate: 0.35, attachRate: 0.4, recurring: false, capabilities: ['production', 'commerce'], status: { customers: EST, atv: EST, margin: EST, repeatRate: EST } },
    { id: 'mu-mixes', vertical: 'music', name: 'Mixing & Mastering', revenue: { 2024: 4 * K, 2025: 4 * K, 2026: 4 * K }, atv: 100, margin: 0.8, customers: 40, growth: 0, repeatRate: 0.2, attachRate: 0.2, recurring: false, capabilities: ['production'], status: { customers: EST, atv: EST, margin: EST } },
    { id: 'cc-systems', vertical: 'creative', name: 'Systems & Automations', revenue: { 2026: 13.3 * K }, atv: 297, margin: 0.8, customers: 7, growth: 0.5, repeatRate: 0.9, attachRate: 0.875, recurring: true, capabilities: ['acquisition', 'retention', 'platform', 'operations'], status: { revenue: EST, margin: EST, repeatRate: EST } },
    { id: 'cc-video', vertical: 'creative', name: 'Video + Social + Meta Retainer', revenue: { 2026: 9.7 * K }, atv: 2000, margin: 0.6, customers: 1, growth: 0.5, repeatRate: 0.9, attachRate: 0.125, recurring: true, capabilities: ['content', 'brand', 'acquisition', 'production'], status: { revenue: EST, margin: EST, repeatRate: EST } },
    { id: 'world-apparel', vertical: 'world', name: 'NuWav World Apparel', revenue: { 2024: 1 * K, 2025: 1 * K, 2026: 1 * K }, atv: 40, margin: 0.5, customers: 25, growth: 0, repeatRate: 0.2, attachRate: 1, recurring: false, capabilities: ['commerce', 'brand'], status: { customers: EST, atv: EST, margin: EST } },
  ],

  segments: [
    {
      id: 'seg-artists', name: 'Independent Artists', b2b: true,
      description: '~200 artists a year using the studio; also World\'s main buyers.',
      customers: 200, revenue: 80.7 * K, retention: 0.2, crossSellPotential: 0.6,
      purchases: [
        { product: 'mu-recording', revenue: 32 * K }, { product: 'mu-videos', revenue: 32 * K },
        { product: 'mu-beats', revenue: 12 * K }, { product: 'mu-mixes', revenue: 4 * K },
        { product: 'world-apparel', revenue: 0.7 * K },
      ],
      status: { crossSellPotential: EST },
    },
    {
      id: 'seg-agency', name: 'Agency Clients', b2b: true,
      description: 'Businesses on Creative Co packages (7 systems, 1 video retainer).',
      customers: 8, revenue: 23 * K, retention: 0.85, crossSellPotential: 0.5,
      purchases: [{ product: 'cc-systems', revenue: 13.3 * K }, { product: 'cc-video', revenue: 9.7 * K }],
      status: { retention: EST, crossSellPotential: EST },
    },
    {
      id: 'seg-fans', name: 'Fans & Shoppers', b2b: false,
      description: 'Apparel buyers outside the studio.',
      customers: 8, revenue: 0.3 * K, retention: 0.2, crossSellPotential: 0.2,
      purchases: [{ product: 'world-apparel', revenue: 0.3 * K }],
      status: { customers: EST, retention: EST, crossSellPotential: EST },
    },
  ],

  infra: [
    {
      id: 'inf-studio', name: 'Studio & Video Gear', category: 'location', annualCost: 12 * K, techDebt: 0.3, dependents: ['music', 'creative'],
      status: { annualCost: EST },
    },
    { id: 'inf-ghl', name: 'GoHighLevel (CRM & automations)', category: 'crm', annualCost: 3.6 * K, techDebt: 0.15, dependents: ['creative'], status: { annualCost: EST } },
    { id: 'inf-ai', name: 'AI Agent Stack', category: 'ai', annualCost: 1.2 * K, techDebt: 0.2, dependents: ['creative'], status: { annualCost: EST } },
    { id: 'inf-shop', name: 'Online Store', category: 'web', annualCost: 0.5 * K, techDebt: 0.3, dependents: ['world'], status: { annualCost: EST } },
  ],

  functions: [
    { id: 'fn-founder', name: 'Founder', fte: 1, annualCost: 0, serves: ['music', 'creative', 'world'], utilization: 0.95, keyPersonRisk: 1, status: { utilization: EST } },
    { id: 'fn-dev', name: 'Website Developer', fte: 0.3, annualCost: 1.44 * K, serves: ['creative'], utilization: 0.5, keyPersonRisk: 0.8, status: { fte: EST, annualCost: EST, utilization: EST } },
  ],

  pairs: [
    {
      a: 'music', b: 'creative', sharedCustomers: 1, eligibleAtoB: 40, eligibleBtoA: 8, currentCrossSellRate: 0.01, targetCrossSellRate: 0.1, crossSellRevenue: 3.6 * K,
      sharedInfra: ['inf-studio'], sharedEmployeesFTE: 1, sharedTech: 0.6, sharedMarketing: 0.7, dataSharing: 0.3, distributionOverlap: 0.3,
      dependency: { from: 'music', to: 'creative', note: 'Creative Co runs NuWav Music\'s marketing' },
      status: { sharedCustomers: EST, eligibleAtoB: EST, eligibleBtoA: EST, crossSellRevenue: EST },
    },
    {
      a: 'music', b: 'world', sharedCustomers: 15, eligibleAtoB: 200, eligibleBtoA: 25, currentCrossSellRate: 0.075, targetCrossSellRate: 0.25, crossSellRevenue: 0.7 * K,
      sharedInfra: [], sharedEmployeesFTE: 1, sharedTech: 0.1, sharedMarketing: 0.3, dataSharing: 0.2, distributionOverlap: 0.4,
      revenueFlow: { from: 'music', to: 'world', amount: 0.7 * K, note: 'Studio artists are NuWav World\'s main buyers' },
      status: { sharedCustomers: EST },
    },
    {
      a: 'creative', b: 'world', sharedCustomers: 0, eligibleAtoB: 8, eligibleBtoA: 25, currentCrossSellRate: 0, targetCrossSellRate: 0.05, crossSellRevenue: 0,
      sharedInfra: [], sharedEmployeesFTE: 1, sharedTech: 0.2, sharedMarketing: 0, dataSharing: 0.1, distributionOverlap: 0.1,
    },
  ],

  affinities: [
    { a: 'mu-recording', b: 'mu-mixes', affinity: 0.9, currentBoth: 30 },
    { a: 'mu-beats', b: 'mu-recording', affinity: 0.75, currentBoth: 40 },
    { a: 'mu-beats', b: 'mu-mixes', affinity: 0.7, currentBoth: 10 },
    { a: 'mu-recording', b: 'mu-videos', affinity: 0.7, currentBoth: 25 },
    { a: 'mu-videos', b: 'cc-video', affinity: 0.6, currentBoth: 0 },
    { a: 'cc-systems', b: 'cc-video', affinity: 0.7, currentBoth: 0 },
    { a: 'mu-recording', b: 'world-apparel', affinity: 0.5, currentBoth: 12 },
    { a: 'mu-videos', b: 'world-apparel', affinity: 0.45, currentBoth: 5 },
  ],

  journeys: [
    { id: 'j-merch', name: 'Studio session → NuWav World merch', steps: ['seg-artists', 'mu-recording', 'music', 'world', 'world-apparel'], customers: 15, revenue: 0.7 * K },
    { id: 'j-systems', name: 'Agency client → Systems subscription', steps: ['seg-agency', 'cc-systems', 'creative', 'parent'], customers: 7, revenue: 13.3 * K },
    { id: 'j-video', name: 'Agency client → Video retainer', steps: ['seg-agency', 'cc-video', 'creative', 'parent'], customers: 1, revenue: 9.7 * K },
  ],

  relations: [
    { id: 'r-video-skill', source: 'mu-videos', target: 'cc-video', type: 'shared_tech', strength: 0.8, label: 'Same gear & skill', note: 'Music video production powers the agency video retainer' },
    { id: 'r-cc-music-mkt', source: 'creative', target: 'music', type: 'shared_marketing', strength: 0.7, label: 'Runs Music marketing' },
  ],
};
