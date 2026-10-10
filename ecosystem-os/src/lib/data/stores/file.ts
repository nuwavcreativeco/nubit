import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AcquisitionInput, CompanyData, SavedScenario } from '@/lib/domain/types';
import type { Repository } from '../repository';
import { seedCompanies, seedFor } from '../seed';

interface Db {
  companies: Record<string, CompanyData>;
  scenarios: SavedScenario[];
  acquisitions: AcquisitionInput[];
}

/** Single-file JSON store for local development and demos. */
export class FileRepository implements Repository {
  readonly kind = 'file';
  private path: string;
  private queue: Promise<unknown> = Promise.resolve();
  private cache: Db | null = null;

  constructor(path: string) {
    this.path = resolve(/*turbopackIgnore: true*/ process.cwd(), path);
  }

  private async db(): Promise<Db> {
    if (this.cache) return this.cache;
    if (existsSync(this.path)) {
      this.cache = JSON.parse(await readFile(this.path, 'utf8')) as Db;
      // Datasets added to the code after the store was created are merged in (never overwritten).
      const missing = seedCompanies().filter((c) => !this.cache!.companies[c.meta.id]);
      if (missing.length) {
        for (const c of missing) this.cache.companies[c.meta.id] = c;
        await this.flush();
      }
    } else {
      this.cache = { companies: Object.fromEntries(seedCompanies().map((c) => [c.meta.id, c])), scenarios: [], acquisitions: [] };
      await this.flush();
    }
    return this.cache;
  }

  // Writes are chained so concurrent requests can't interleave and corrupt the file.
  private flush() {
    const snapshot = JSON.stringify(this.cache);
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, snapshot);
    });
    return this.queue;
  }

  async listCompanies() {
    return Object.values((await this.db()).companies).map((c) => c.meta);
  }
  async getCompany(id: string) {
    return (await this.db()).companies[id] ?? null;
  }
  async saveCompany(data: CompanyData) {
    (await this.db()).companies[data.meta.id] = data;
    await this.flush();
  }
  async resetCompany(id: string) {
    const seed = seedFor(id);
    if (!seed) return null;
    (await this.db()).companies[id] = seed;
    await this.flush();
    return seed;
  }
  async listScenarios(companyId: string) {
    return (await this.db()).scenarios.filter((s) => s.companyId === companyId);
  }
  async saveScenario(s: SavedScenario) {
    const db = await this.db();
    db.scenarios = [s, ...db.scenarios.filter((x) => x.id !== s.id)];
    await this.flush();
  }
  async deleteScenario(id: string) {
    const db = await this.db();
    db.scenarios = db.scenarios.filter((x) => x.id !== id);
    await this.flush();
  }
  async listAcquisitions(companyId: string) {
    return (await this.db()).acquisitions.filter((a) => a.companyId === companyId);
  }
  async saveAcquisition(a: AcquisitionInput) {
    const db = await this.db();
    db.acquisitions = [a, ...db.acquisitions.filter((x) => x.id !== a.id)];
    await this.flush();
  }
  async deleteAcquisition(id: string) {
    const db = await this.db();
    db.acquisitions = db.acquisitions.filter((x) => x.id !== id);
    await this.flush();
  }
}
