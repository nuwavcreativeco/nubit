import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AcquisitionInput, CompanyData, SavedScenario } from '@/lib/domain/types';
import type { Repository } from '../repository';
import { seedCompanies, seedFor } from '../seed';

/**
 * Postgres-backed store via Supabase. Schema: supabase/migrations/0001_ecosystem.sql.
 * Uses the service-role key server-side only; tables have RLS enabled with no public policies.
 */
export class SupabaseRepository implements Repository {
  readonly kind = 'supabase';
  private sb: SupabaseClient;
  private seeded = false;

  constructor(url: string, serviceKey: string) {
    this.sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  private async ensureSeed() {
    if (this.seeded) return;
    const { count, error } = await this.sb.from('companies').select('id', { count: 'exact', head: true });
    if (error) throw error;
    if (!count) {
      const rows = seedCompanies().map((c) => ({ id: c.meta.id, name: c.meta.name, data: c }));
      const { error: e } = await this.sb.from('companies').insert(rows);
      if (e) throw e;
    }
    this.seeded = true;
  }

  async listCompanies() {
    await this.ensureSeed();
    const { data, error } = await this.sb.from('companies').select('data->meta').order('name');
    if (error) throw error;
    return (data as unknown as { meta: CompanyData['meta'] }[]).map((r) => r.meta);
  }
  async getCompany(id: string) {
    await this.ensureSeed();
    const { data, error } = await this.sb.from('companies').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data?.data as CompanyData) ?? null;
  }
  async saveCompany(c: CompanyData) {
    const { error } = await this.sb.from('companies').upsert({ id: c.meta.id, name: c.meta.name, data: c, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  async resetCompany(id: string) {
    const seed = seedFor(id);
    if (!seed) return null;
    await this.saveCompany(seed);
    return seed;
  }
  async listScenarios(companyId: string) {
    const { data, error } = await this.sb.from('scenarios').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, companyId: r.company_id, name: r.name, params: r.params, createdAt: r.created_at }));
  }
  async saveScenario(s: SavedScenario) {
    const { error } = await this.sb.from('scenarios').upsert({ id: s.id, company_id: s.companyId, name: s.name, params: s.params, created_at: s.createdAt });
    if (error) throw error;
  }
  async deleteScenario(id: string) {
    const { error } = await this.sb.from('scenarios').delete().eq('id', id);
    if (error) throw error;
  }
  async listAcquisitions(companyId: string) {
    const { data, error } = await this.sb.from('acquisitions').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({ ...(r.input as AcquisitionInput), id: r.id, companyId: r.company_id, createdAt: r.created_at }));
  }
  async saveAcquisition(a: AcquisitionInput) {
    const { error } = await this.sb.from('acquisitions').upsert({ id: a.id, company_id: a.companyId, input: a, created_at: a.createdAt });
    if (error) throw error;
  }
  async deleteAcquisition(id: string) {
    const { error } = await this.sb.from('acquisitions').delete().eq('id', id);
    if (error) throw error;
  }
}
