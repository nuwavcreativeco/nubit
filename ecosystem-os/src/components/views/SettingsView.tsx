'use client';
import { useRef, useState } from 'react';
import { Download, FileJson, RotateCcw, Upload, Check, Clock } from 'lucide-react';
import { useApp } from '@/store/app';
import { api } from '@/lib/data/client';
import { CONNECTORS } from '@/lib/data/connectors/registry';
import { csvTemplate, mergeCsv, type CsvTable } from '@/lib/data/connectors/csv';
import { parseCompany } from '@/lib/domain/schema';
import { STATUS_HINT, STATUS_LABEL } from '@/lib/domain/provenance';
import { download } from '@/lib/export/csv';
import type { DataStatus } from '@/lib/domain/types';
import { Btn, Panel, StatusBadge } from '@/components/ui/primitives';

export function SettingsView() {
  const s = useApp();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null);
  const [table, setTable] = useState<CsvTable>('verticals');
  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  if (!s.data) return null;

  const save = async (next: typeof s.data, label: string) => {
    try {
      const saved = await api.saveCompany(next!);
      s.replaceCompany(saved);
      setMsg({ ok: true, text: label });
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setMsg({ ok: false, text: err.message, details: err.details });
    }
  };

  const onJson = async (file: File) => {
    const parsed = parseCompany(JSON.parse(await file.text()));
    if (!parsed.ok) return setMsg({ ok: false, text: 'JSON failed validation', details: parsed.errors });
    if (parsed.data.meta.id !== s.companyId) return setMsg({ ok: false, text: `meta.id is "${parsed.data.meta.id}" but the open company is "${s.companyId}". Change meta.id to replace it.` });
    await save(parsed.data, `Imported ${file.name}`);
  };

  const onCsv = async (file: File) => {
    const r = mergeCsv(s.data!, table, await file.text());
    const parsed = parseCompany(r.data);
    if (!parsed.ok) return setMsg({ ok: false, text: 'Merged data failed validation', details: [...r.warnings, ...parsed.errors] });
    await save(parsed.data, `CSV ${table}: ${r.created.length} created, ${r.updated.length} updated${r.warnings.length ? ` · ${r.warnings.length} warnings` : ''}`);
    if (r.warnings.length) setMsg({ ok: true, text: `CSV ${table}: ${r.created.length} created, ${r.updated.length} updated`, details: r.warnings });
  };

  const counts = { verticals: s.data.verticals.length, products: s.data.products.length, segments: s.data.segments.length, infra: s.data.infra.length, pairs: s.data.pairs.length };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-5">
        <div className="label">Settings & data</div>
        <h1 className="mt-1 text-[20px] font-medium text-fg">Data sources</h1>
        <p className="max-w-3xl text-[12px] text-muted">
          Everything in the product is computed from one validated document — the CompanyData schema. Connectors only have to produce that document;
          the graph, analytics and AI layer don&apos;t change when the source does.
        </p>
      </div>

      {msg && (
        <div className={`mb-4 border px-3 py-2 text-[12px] ${msg.ok ? 'border-[color-mix(in_oklch,var(--pos)_40%,transparent)] text-fg' : 'border-[color-mix(in_oklch,var(--neg)_40%,transparent)] text-neg'}`}>
          {msg.text}
          {msg.details && <ul className="mt-1 space-y-0.5 text-[11px] text-fg-2">{msg.details.map((d) => <li key={d}>· {d}</li>)}</ul>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <div className="space-y-4">
          <Panel title="Current dataset" right={<span className="num text-[10px] text-muted">{s.data.meta.source} · as of {s.data.meta.asOf}</span>}>
            <div className="mb-3 text-[13px] text-fg">{s.data.meta.name}</div>
            {s.data.meta.description && <p className="mb-3 text-[12px] text-muted">{s.data.meta.description}</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Object.entries(counts).map(([k, v]) => <div key={k} className="border border-line px-2.5 py-2"><div className="label !text-[9px]">{k}</div><div className="num text-[16px] text-fg">{v}</div></div>)}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn variant="outline" onClick={() => download(`${s.data!.meta.id}.json`, JSON.stringify(s.data, null, 2), 'application/json')}><Download className="size-3.5" />Export JSON</Btn>
              <Btn variant="outline" onClick={() => window.open('/api/schema', '_blank')}><FileJson className="size-3.5" />JSON Schema</Btn>
              <Btn variant="danger" onClick={async () => { if (!confirm('Reset this company to its built-in dataset? Imported changes will be lost.')) return; const d = await api.resetCompany(s.companyId!); s.replaceCompany(d); setMsg({ ok: true, text: 'Reset to built-in dataset' }); }}><RotateCcw className="size-3.5" />Reset to built-in</Btn>
            </div>
          </Panel>

          <Panel title="Import">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[12px] text-fg">Full JSON snapshot</div>
                <p className="mb-2 text-[11px] text-muted">Replaces the open company. Validated against the schema, including referential integrity.</p>
                <input ref={jsonRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && onJson(e.target.files[0])} />
                <Btn variant="outline" onClick={() => jsonRef.current?.click()}><Upload className="size-3.5" />Upload JSON</Btn>
              </div>
              <div>
                <div className="mb-1 text-[12px] text-fg">CSV table</div>
                <p className="mb-2 text-[11px] text-muted">Upserts rows by id into the open company. Add a <span className="num">year</span> column for history.</p>
                <div className="flex gap-2">
                  <select value={table} onChange={(e) => setTable(e.target.value as CsvTable)} className="border border-line bg-panel-2 px-2 text-[12px] text-fg outline-none">
                    <option value="verticals">verticals</option><option value="products">products</option><option value="segments">segments</option>
                  </select>
                  <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
                  <Btn variant="outline" onClick={() => csvRef.current?.click()}><Upload className="size-3.5" />Upload</Btn>
                  <Btn onClick={() => download(`${table}-template.csv`, csvTemplate(table))}><Download className="size-3.5" />Template</Btn>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Integrations">
            <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="text-left"><th className="label pb-2 font-normal">Source</th><th className="label pb-2 font-normal">Fills</th><th className="label pb-2 font-normal">Status</th></tr></thead>
              <tbody>
                {CONNECTORS.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3"><div className="text-fg">{c.name}</div><div className="mt-0.5 max-w-md text-[11px] text-muted">{c.mapping}</div></td>
                    <td className="py-2 pr-3 text-[11px] text-fg-2">{c.provides.join(', ')}</td>
                    <td className="py-2">{c.status === 'available' ? <span className="flex items-center gap-1 text-[11px] text-pos"><Check className="size-3" />Available</span> : <span className="flex items-center gap-1 text-[11px] text-muted"><Clock className="size-3" />Planned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="System">
            <dl className="space-y-2 text-[12px]">
              <div className="flex justify-between"><dt className="text-muted">Storage</dt><dd className="num text-fg">{s.system?.storage}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">AI analyst</dt><dd className="num text-fg">{s.system?.ai === 'claude' ? 'Claude (tool use)' : 'Deterministic fallback'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Authentication</dt><dd className="num text-fg">{s.system?.auth}</dd></div>
            </dl>
            <div className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
              Configure in <span className="num text-fg-2">.env.local</span>:
              <pre className="num mt-1.5 overflow-x-auto bg-bg p-2 text-[10.5px] text-fg-2">{`ANTHROPIC_API_KEY=...        # enables the Claude analyst
SUPABASE_URL=...             # switch storage to Postgres
SUPABASE_SERVICE_ROLE_KEY=...
APP_PASSWORD=...             # password-protect the app
AUTH_SECRET=...              # cookie signing secret`}</pre>
            </div>
          </Panel>

          <Panel title="Data confidence labels">
            <div className="space-y-2.5">
              {(['actual', 'estimated', 'projected', 'ai', 'user'] as DataStatus[]).map((st) => (
                <div key={st}>
                  <div className="flex items-center gap-2"><StatusBadge status={st} /><span className="text-[12px] text-fg">{STATUS_LABEL[st]}</span></div>
                  <p className="mt-0.5 text-[11px] text-muted">{STATUS_HINT[st]}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">Override per field in the data with a <span className="num text-fg-2">status</span> map, e.g. <span className="num text-fg-2">{`"status": { "revenue": "estimated" }`}</span>.</p>
          </Panel>

          <Panel title="Scale">
            <p className="text-[12px] text-fg-2">Open <span className="text-fg">Atlas Group (scale test)</span> from the company selector to see ~1,000 nodes. The graph starts at vertical level, expands per vertical, and drops labels and particles when zoomed out.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
