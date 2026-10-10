// Data model for a parent company ecosystem.
// Everything the UI shows — scores, opportunities, insights — is derived from this shape,
// so swapping in a different company's data re-generates the whole analysis.

export type Year = number;

/** Provenance of every number shown in the product. Assumptions are never presented as facts. */
export type DataStatus = 'actual' | 'estimated' | 'projected' | 'ai' | 'user';

/** Optional per-field overrides, e.g. { tam: 'estimated', revenue: 'actual' }. */
export type FieldStatus = Partial<Record<string, DataStatus>>;

export interface CompanyMeta {
  id: string;
  name: string;
  currency: string;
  asOf: string; // ISO date the actuals were last refreshed
  source: string; // 'mock' | 'csv' | 'stripe' | ... — which connector produced this snapshot
  description?: string;
}
export type Series = Record<string, number>; // year -> value

export type NodeKind =
  | 'parent'
  | 'vertical'
  | 'product'
  | 'segment'
  | 'infra'
  | 'function'
  | 'acquisition';

export type RelType =
  | 'ownership'
  | 'revenue'
  | 'customer_overlap'
  | 'dependency'
  | 'cross_sell'
  | 'shared_infra'
  | 'partnership'
  | 'shared_tech'
  | 'shared_employees'
  | 'shared_marketing'
  | 'shared_data'
  | 'shared_distribution';

export interface ParentCompany {
  status?: FieldStatus;
  id: string;
  name: string;
  tagline: string;
  currentYear: Year;
  years: Year[]; // full timeline, past..projected
  cash: number;
  monthlyOpex: number;
  workingCapitalMonths: number; // months of opex covered by liquid working capital
  debt: number;
  topCustomerShare: number; // share of revenue from the single largest customer
  markets: string[];
}

export interface VerticalOps {
  leadsPerMonth: number;
  leadsNeeded: number; // leads/month required to hit growth target
  utilization: number; // delivery capacity utilization 0-1
  keyPersonRisk: number; // 0-1, dependency on one or two individuals
  topCustomerShare: number; // share of vertical revenue from largest customer
}

export interface ExpansionMarket {
  market: string;
  sizeRatio: number; // market size relative to current served market
  capture: number; // realistic share of current performance achievable
  investment: number;
  months: number;
}

export interface Vertical {
  status?: FieldStatus;
  id: string;
  name: string;
  hue: number; // OKLCH hue — children inherit shades of this
  icon: string; // lucide icon name
  description: string;
  launchYear?: Year;
  sunsetYear?: Year;
  revenue: Series; // actuals for past/current years, explicit plan for future (optional)
  projectedGrowth: number; // base-case annual growth used for missing future years
  grossMargin: number;
  ebitdaMargin: number;
  contributionMargin: number;
  customers: number;
  employees: number;
  recurringShare: number;
  cac: number;
  ltv: number;
  retention: number;
  tam: number;
  sam: number;
  strategicImportance: number; // 0-10
  growthPotential: number; // 0-10
  marketingSpend: number;
  requiredInvestment: number;
  b2b: boolean;
  ops: VerticalOps;
  expansion?: ExpansionMarket[];
  supplyChain?: { name: string; externalSpend: number; inHouseSavingsRate: number; investment: number };
  risks: string[];
}

export interface Product {
  status?: FieldStatus;
  id: string;
  vertical: string;
  name: string;
  revenue: Series;
  atv: number; // average transaction value
  margin: number; // gross margin
  customers: number;
  growth: number;
  repeatRate: number;
  attachRate: number; // share of vertical customers buying this
  recurring: boolean;
  capabilities: string[]; // themes used to detect natural bundles
  upsell?: { to: string; priceUplift: number; rate: number };
  launchYear?: Year;
  sunsetYear?: Year;
}

export interface Segment {
  status?: FieldStatus;
  id: string;
  name: string;
  description: string;
  customers: number;
  revenue: number;
  retention: number;
  crossSellPotential: number; // 0-1
  purchases: { product: string; revenue: number }[];
  b2b: boolean;
}

export interface Infra {
  status?: FieldStatus;
  id: string;
  name: string;
  category: 'crm' | 'web' | 'data' | 'ai' | 'payments' | 'distribution' | 'location' | 'other';
  annualCost: number;
  techDebt: number; // 0-1
  dependents: string[]; // vertical ids
  externalizable?: { offer: string; customers: number; price: number; confidence: number; investment: number };
  dataRecords?: number;
}

export interface SharedFunction {
  status?: FieldStatus;
  id: string;
  name: string;
  fte: number;
  annualCost: number;
  serves: string[]; // vertical ids
  utilization: number;
  keyPersonRisk: number;
}

export interface VerticalPair {
  status?: FieldStatus;
  a: string;
  b: string;
  sharedCustomers: number;
  eligibleAtoB: number; // A customers who could plausibly buy from B
  eligibleBtoA: number;
  currentCrossSellRate: number;
  targetCrossSellRate: number;
  crossSellRevenue: number; // current annual revenue from cross-sold customers
  sharedInfra: string[];
  sharedEmployeesFTE: number;
  sharedTech: number; // 0-1
  sharedMarketing: number; // 0-1
  dataSharing: number; // 0-1
  distributionOverlap: number; // 0-1
  partnership?: string;
  dependency?: { from: string; to: string; note: string };
  revenueFlow?: { from: string; to: string; amount: number; note: string };
}

export interface ProductAffinity {
  a: string;
  b: string;
  affinity: number; // 0-1 natural fit
  currentBoth: number; // customers currently buying both
}

export interface Journey {
  id: string;
  name: string;
  steps: string[]; // node ids in order
  customers: number;
  revenue: number;
}

export interface Relation {
  id: string;
  source: string;
  target: string;
  type: RelType;
  strength: number; // 0-1
  value?: number;
  label?: string;
  note?: string;
}

export interface CompanyData {
  meta: CompanyMeta;
  parent: ParentCompany;
  verticals: Vertical[];
  products: Product[];
  segments: Segment[];
  infra: Infra[];
  functions: SharedFunction[];
  pairs: VerticalPair[];
  affinities: ProductAffinity[];
  journeys: Journey[];
  relations: Relation[]; // explicit extra relationships (dependencies, partnerships)
}

export interface ScenarioParams {
  customerGrowth: number;
  pricing: number;
  crossSellRate: number;
  retention: number;
  newVertical: number;
  costEfficiency: number;
  /** Unit-level plans: extra annual growth for one vertical, compounding from `startYear`. */
  verticalPlans?: Record<string, VerticalPlan>;
}

export interface VerticalPlan {
  extraGrowth: number; // e.g. 1.0 = an extra +100% per year on top of base-case growth
  startYear: number;
}

export interface SavedScenario {
  id: string;
  companyId: string;
  name: string;
  params: ScenarioParams;
  createdAt: string;
}

export interface AcquisitionInput {
  id?: string;
  companyId?: string;
  name: string;
  price: number;
  revenue: number;
  ebitda: number;
  customers: number;
  employees: number;
  growth: number;
  services: string[]; // capability tags
  segments: string[]; // segment ids it serves
  geography: string[];
  infra: string[]; // infra categories it runs on
  createdAt?: string;
}
