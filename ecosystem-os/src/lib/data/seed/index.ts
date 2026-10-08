import type { CompanyData } from '@/lib/domain/types';
import { meridian } from './meridian';
import { nuwav } from './nuwav';
import { generateCompany } from './generator';

/** Built-in datasets. Live connectors replace these; nothing in the app depends on their contents. */
export function seedCompanies(): CompanyData[] {
  return [structuredClone(nuwav), structuredClone(meridian), generateCompany({ id: 'atlas', name: 'Atlas Group (scale test)', verticals: 10, productsPerVertical: 88, segments: 60, infra: 36, seed: 7 })];
}

export function seedFor(id: string): CompanyData | null {
  return seedCompanies().find((c) => c.meta.id === id) ?? null;
}
