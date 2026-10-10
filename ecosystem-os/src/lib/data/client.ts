import type { AcquisitionInput, CompanyData, CompanyMeta, SavedScenario, ScenarioParams } from '@/lib/domain/types';

/** Browser-side API client. The UI never talks to storage directly. */
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `Request failed (${res.status})`) as Error & { details?: unknown };
    err.details = body.details;
    throw err;
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  system: () => req<{ storage: string; ai: 'claude' | 'local'; auth: string }>('/api/system'),
  companies: () => req<CompanyMeta[]>('/api/companies'),
  company: (id: string) => req<CompanyData>(`/api/companies/${id}`),
  saveCompany: (c: CompanyData) => req<CompanyData>(`/api/companies/${c.meta.id}`, { method: 'PUT', body: JSON.stringify(c) }),
  resetCompany: (id: string) => req<CompanyData>(`/api/companies/${id}/reset`, { method: 'POST' }),
  scenarios: (id: string) => req<SavedScenario[]>(`/api/companies/${id}/scenarios`),
  saveScenario: (id: string, name: string, params: ScenarioParams) => req<SavedScenario>(`/api/companies/${id}/scenarios`, { method: 'POST', body: JSON.stringify({ name, params }) }),
  deleteScenario: (id: string) => req<void>(`/api/scenarios/${id}`, { method: 'DELETE' }),
  acquisitions: (id: string) => req<AcquisitionInput[]>(`/api/companies/${id}/acquisitions`),
  saveAcquisition: (id: string, a: AcquisitionInput) => req<AcquisitionInput>(`/api/companies/${id}/acquisitions`, { method: 'POST', body: JSON.stringify(a) }),
  deleteAcquisition: (id: string) => req<void>(`/api/acquisitions/${id}`, { method: 'DELETE' }),
};
