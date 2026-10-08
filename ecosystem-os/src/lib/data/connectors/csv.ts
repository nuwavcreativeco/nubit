import Papa from 'papaparse';
import type { CompanyData, Product, Segment, Vertical } from '@/lib/domain/types';
import { CSV_TEMPLATES } from './registry';

export type CsvTable = keyof typeof CSV_TEMPLATES;

export interface CsvMergeResult {
  data: CompanyData;
  created: string[];
  updated: string[];
  warnings: string[];
}

const n = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));
const b = (v: string | undefined) => (v === undefined || v === '' ? undefined : /^(true|1|yes)$/i.test(v));

/** Upserts CSV rows into a copy of the company. Unknown columns are ignored; missing ones keep existing values. */
export function mergeCsv(company: CompanyData, table: CsvTable, text: string): CsvMergeResult {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const data = structuredClone(company);
  const created: string[] = [], updated: string[] = [], warnings: string[] = parsed.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.message}`);
  const missing = CSV_TEMPLATES[table].columns.filter((c) => !parsed.meta.fields?.includes(c) && c !== 'year');
  if (missing.includes('id')) return { data: company, created, updated, warnings: [...warnings, 'Missing required "id" column'] };
  const touch = (id: string, isNew: boolean) => (isNew ? created : updated).includes(id) || (isNew ? created : updated).push(id);

  for (const row of parsed.data) {
    const id = row.id?.trim();
    if (!id) continue;
    const year = row.year?.trim() || String(data.parent.currentYear);

    if (table === 'verticals') {
      let v = data.verticals.find((x) => x.id === id);
      const isNew = !v;
      if (!v) {
        v = { ...structuredClone(data.verticals[0]), id, name: row.name || id, revenue: {}, expansion: undefined, supplyChain: undefined, launchYear: undefined, sunsetYear: undefined, hue: (data.verticals.length * 47) % 360, risks: [], status: { tam: 'estimated', sam: 'estimated' } } as Vertical;
        data.verticals.push(v);
      }
      if (row.name) v.name = row.name;
      if (n(row.revenue) !== undefined) v.revenue[year] = n(row.revenue)!;
      for (const k of ['grossMargin', 'ebitdaMargin', 'customers', 'employees', 'recurringShare', 'retention'] as const) if (n(row[k]) !== undefined) (v as unknown as Record<string, number>)[k] = n(row[k])!;
      touch(id, isNew);
    } else if (table === 'products') {
      const vertical = row.vertical?.trim();
      if (vertical && !data.verticals.some((v) => v.id === vertical)) { warnings.push(`Product "${id}": unknown vertical "${vertical}" — skipped`); continue; }
      let p = data.products.find((x) => x.id === id);
      const isNew = !p;
      if (!p) {
        if (!vertical) { warnings.push(`Product "${id}" is new but has no vertical — skipped`); continue; }
        p = { id, vertical, name: row.name || id, revenue: {}, atv: 0, margin: 0.5, customers: 0, growth: 0, repeatRate: 0.5, attachRate: 0.1, recurring: false, capabilities: [] } as Product;
        data.products.push(p);
      }
      if (row.name) p.name = row.name;
      if (vertical) p.vertical = vertical;
      if (n(row.revenue) !== undefined) p.revenue[year] = n(row.revenue)!;
      if (n(row.customers) !== undefined) p.customers = n(row.customers)!;
      if (n(row.margin) !== undefined) p.margin = n(row.margin)!;
      if (b(row.recurring) !== undefined) p.recurring = b(row.recurring)!;
      if (p.customers) p.atv = Math.round((p.revenue[year] ?? 0) / p.customers);
      touch(id, isNew);
    } else {
      let s = data.segments.find((x) => x.id === id);
      const isNew = !s;
      if (!s) {
        s = { id, name: row.name || id, description: 'Imported segment', customers: 0, revenue: 0, retention: 0.8, crossSellPotential: 0.5, purchases: [], b2b: true } as Segment;
        data.segments.push(s);
      }
      if (row.name) s.name = row.name;
      if (n(row.customers) !== undefined) s.customers = n(row.customers)!;
      if (n(row.retention) !== undefined) s.retention = n(row.retention)!;
      if (row.product) {
        if (!data.products.some((p) => p.id === row.product)) warnings.push(`Segment "${id}": unknown product "${row.product}" — purchase skipped`);
        else {
          const existing = s.purchases.find((p) => p.product === row.product);
          const amount = n(row.productRevenue) ?? 0;
          if (existing) existing.revenue = amount;
          else s.purchases.push({ product: row.product, revenue: amount });
        }
      }
      s.revenue = s.purchases.reduce((a, p) => a + p.revenue, 0);
      touch(id, isNew);
    }
  }
  data.meta = { ...data.meta, source: data.meta.source.includes('csv') ? data.meta.source : `${data.meta.source}+csv`, asOf: new Date().toISOString().slice(0, 10) };
  return { data, created, updated, warnings };
}

export function csvTemplate(table: CsvTable) {
  const t = CSV_TEMPLATES[table];
  return `${t.columns.join(',')}\n${t.example.join(',')}\n`;
}
