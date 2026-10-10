import 'server-only';
import type { AcquisitionInput, CompanyData, CompanyMeta, SavedScenario } from '@/lib/domain/types';

/**
 * Storage boundary. UI and API routes depend on this interface only, so the backing
 * store (local JSON, Supabase/Postgres, a warehouse) can change without touching callers.
 */
export interface Repository {
  readonly kind: string;
  listCompanies(): Promise<CompanyMeta[]>;
  getCompany(id: string): Promise<CompanyData | null>;
  saveCompany(data: CompanyData): Promise<void>;
  resetCompany(id: string): Promise<CompanyData | null>;
  listScenarios(companyId: string): Promise<SavedScenario[]>;
  saveScenario(s: SavedScenario): Promise<void>;
  deleteScenario(id: string): Promise<void>;
  listAcquisitions(companyId: string): Promise<AcquisitionInput[]>;
  saveAcquisition(a: AcquisitionInput): Promise<void>;
  deleteAcquisition(id: string): Promise<void>;
}

let instance: Repository | null = null;

export async function getRepository(): Promise<Repository> {
  if (instance) return instance;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { SupabaseRepository } = await import('./stores/supabase');
    instance = new SupabaseRepository(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  } else {
    const { FileRepository } = await import('./stores/file');
    instance = new FileRepository(process.env.DATA_FILE ?? '.data/db.json');
  }
  return instance;
}
