/**
 * Integration registry. Each connector maps a source system onto parts of the CompanyData
 * contract (src/lib/domain/schema.ts). A connector only has to produce valid CompanyData
 * fragments; merging, validation and analytics are shared.
 */
export type ConnectorCategory = 'file' | 'finance' | 'payments' | 'commerce' | 'crm' | 'analytics' | 'ads' | 'api';

export interface ConnectorDef {
  id: string;
  name: string;
  category: ConnectorCategory;
  status: 'available' | 'planned';
  provides: string[]; // CompanyData sections it fills
  mapping: string; // how source objects map to the model
}

export const CONNECTORS: ConnectorDef[] = [
  { id: 'json', name: 'JSON snapshot', category: 'file', status: 'available', provides: ['everything'], mapping: 'A full document matching the CompanyData JSON Schema. Replaces the company.' },
  { id: 'csv', name: 'CSV tables', category: 'file', status: 'available', provides: ['verticals', 'products', 'segments'], mapping: 'One CSV per table (templates below). Rows upsert by id; one row per id per year for revenue.' },
  { id: 'excel', name: 'Excel workbook', category: 'file', status: 'planned', provides: ['verticals', 'products', 'segments'], mapping: 'Same sheets as the CSV templates, one sheet per table.' },
  { id: 'quickbooks', name: 'QuickBooks / Xero', category: 'finance', status: 'planned', provides: ['verticals.revenue', 'verticals.grossMargin', 'verticals.ebitdaMargin', 'parent.cash', 'parent.debt'], mapping: 'P&L by class/location → vertical revenue & margins; balance sheet → cash, debt, working capital.' },
  { id: 'stripe', name: 'Stripe', category: 'payments', status: 'planned', provides: ['products.revenue', 'products.customers', 'verticals.recurringShare', 'verticals.retention'], mapping: 'Products/prices → products; subscriptions → recurring share & retention; charges → revenue by product.' },
  { id: 'shopify', name: 'Shopify', category: 'commerce', status: 'planned', provides: ['products', 'segments', 'affinities'], mapping: 'Orders → product revenue, ATV, repeat rate; line-item co-occurrence → product affinities.' },
  { id: 'hubspot', name: 'HubSpot', category: 'crm', status: 'planned', provides: ['segments', 'pairs.sharedCustomers', 'verticals.ops.leadsPerMonth'], mapping: 'Companies + deals by pipeline → customers per vertical, overlap, lead flow.' },
  { id: 'salesforce', name: 'Salesforce', category: 'crm', status: 'planned', provides: ['segments', 'pairs.sharedCustomers', 'verticals.ops'], mapping: 'Accounts/opportunities by business unit → segments, cross-vertical overlap, pipeline.' },
  { id: 'ga4', name: 'Google Analytics', category: 'analytics', status: 'planned', provides: ['verticals.ops.leadsPerMonth', 'journeys'], mapping: 'Conversions by property → lead flow; cross-domain paths → customer journeys.' },
  { id: 'ads', name: 'Ad platforms (Google, Meta)', category: 'ads', status: 'planned', provides: ['verticals.marketingSpend', 'verticals.cac'], mapping: 'Spend and conversions by account → marketing spend and CAC per vertical.' },
  { id: 'rest', name: 'REST / webhook API', category: 'api', status: 'available', provides: ['everything'], mapping: 'PUT /api/companies/{id} with a CompanyData document; validated against the schema.' },
];

export const CSV_TEMPLATES: Record<'verticals' | 'products' | 'segments', { columns: string[]; example: string[] }> = {
  verticals: {
    columns: ['id', 'name', 'year', 'revenue', 'grossMargin', 'ebitdaMargin', 'customers', 'employees', 'recurringShare', 'retention'],
    example: ['marketing', 'Marketing', '2026', '5800000', '0.58', '0.19', '420', '38', '0.62', '0.82'],
  },
  products: {
    columns: ['id', 'vertical', 'name', 'year', 'revenue', 'customers', 'margin', 'recurring'],
    example: ['mkt-seo', 'marketing', 'SEO', '2026', '1300000', '160', '0.62', 'true'],
  },
  segments: {
    columns: ['id', 'name', 'customers', 'retention', 'product', 'productRevenue'],
    example: ['seg-local', 'Local Service SMBs', '1650', '0.82', 'mkt-seo', '1000000'],
  },
};
