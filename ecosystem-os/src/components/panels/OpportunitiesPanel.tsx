'use client';
import { useMemo, useState } from 'react';
import { Crosshair, Save, Trash2 } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAcquisitionOverlay, useAnalysis, useBaselineAnalysis } from '@/store/useAnalysis';
import { OPPORTUNITY_LABEL, difficultyLabel, type OpportunityType } from '@/lib/analytics/opportunities';
import { ALL_CAPABILITIES, INFRA_CATEGORIES } from '@/lib/analytics/acquisition';
import { money, months, pct, sum } from '@/lib/analytics/format';
import type { AcquisitionInput } from '@/lib/domain/types';
import { Btn, Metric, Section, Segmented, StatusBadge } from '@/components/ui/primitives';
import { BubbleChart } from '@/components/ui/charts';
import { CATEGORICAL } from '@/lib/graph/theme';

type Tab = 'engine' | 'overlap' | 'acquisition';

// Opportunity types are a categorical dimension; each gets a fixed slot from the validated palette.
const TYPE_COLOR: Record<OpportunityType, string> = {
  cross_sell: CATEGORICAL[0].hex, upsell: CATEGORICAL[1].hex, bundle: CATEGORICAL[2].hex, geographic: CATEGORICAL[3].hex,
  customer_expansion: CATEGORICAL[4].hex, subscription: CATEGORICAL[5].hex, infra_monetization: CATEGORICAL[6].hex,
  data_monetization: CATEGORICAL[7].hex, vertical_integration: '#8b95a3', internal_leverage: '#c4c9d1',
};

export function OpportunitiesPanel() {
  const [tab, setTab] = useState<Tab>('engine');
  return (
    <>
      <div className="border-b border-line px-4 py-2.5">
        <Segmented<Tab> size="xs" value={tab} onChange={setTab} options={[{ value: 'engine', label: 'Opportunity engine' }, { value: 'overlap', label: 'Offer overlap' }, { value: 'acquisition', label: 'Acquisition' }]} />
      </div>
      {tab === 'engine' && <Engine />}
      {tab === 'overlap' && <Overlap />}
      {tab === 'acquisition' && <Acquisition />}
    </>
  );
}

function Engine() {
  const s = useApp();
  const a = useAnalysis();
  const [type, setType] = useState<OpportunityType | 'all'>('all');
  const [sel, setSel] = useState<string | null>(null);
  if (!a) return null;
  const list = a.opportunities.filter((o) => type === 'all' || o.type === type);
  const types = [...new Set(a.opportunities.map((o) => o.type))];
  const pick = (id: string) => {
    setSel(id);
    const o = a.opportunities.find((x) => x.id === id);
    if (o?.nodeIds[0]) { s.select(o.nodeIds[0]); s.requestFit(o.nodeIds); }
  };
  return (
    <>
      <Section title="Pipeline" right={<StatusBadge status="estimated" />}>
        <div className="grid grid-cols-3 gap-3">
          <Metric size="sm" label="Revenue" value={money(sum(list.map((o) => o.revenue)))} status="estimated" />
          <Metric size="sm" label="Profit" value={money(sum(list.map((o) => o.profit)))} status="estimated" />
          <Metric size="sm" label="Investment" value={money(sum(list.map((o) => o.investment)))} status="estimated" />
        </div>
        <p className="mt-2 text-[10px] text-muted">Totals overlap — several opportunities address the same customers.</p>
      </Section>
      <Section title="Opportunity map">
        <BubbleChart
          selected={sel}
          onClick={pick}
          items={list.map((o) => ({ id: o.id, x: o.months, y: o.confidence, r: o.revenue || o.profit, color: TYPE_COLOR[o.type], label: o.name, detail: <span className="num">{money(o.revenue)} rev · {money(o.profit)} profit · {pct(o.confidence)} conf.</span> }))}
        />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <button onClick={() => setType('all')} className={`text-[11px] ${type === 'all' ? 'text-fg' : 'text-muted hover:text-fg-2'}`}>All</button>
          {types.map((t) => (
            <button key={t} onClick={() => setType(type === t ? 'all' : t)} className={`flex items-center gap-1 text-[11px] ${type === t ? 'text-fg' : 'text-muted hover:text-fg-2'}`}>
              <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />{OPPORTUNITY_LABEL[t]}
            </button>
          ))}
        </div>
      </Section>
      <Section title={`Ranked · ${list.length}`} right={<span className="text-[10px] text-muted">by opportunity score</span>}>
        {list.map((o) => (
          <button key={o.id} onClick={() => pick(o.id)} className={`mb-1.5 block w-full border p-2.5 text-left ${sel === o.id ? 'border-fg-2 bg-panel-2' : 'border-line hover:border-line-2'}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] leading-snug text-fg">{o.name}</span>
              <span className="num shrink-0 text-[12px] text-pos">{o.revenue ? `+${money(o.revenue)}` : `${money(o.profit)} saved`}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted"><span className="size-1.5 rounded-full" style={{ background: TYPE_COLOR[o.type] }} />{OPPORTUNITY_LABEL[o.type]}</div>
            {sel === o.id && (
              <div className="fade-in mt-2 space-y-1.5">
                <p className="text-[11px] text-fg-2">{o.description}</p>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div><div className="label !text-[9px]">Profit</div><div className="num text-fg">{money(o.profit)}</div></div>
                  <div><div className="label !text-[9px]">Confidence</div><div className="num text-fg">{pct(o.confidence)}</div></div>
                  <div><div className="label !text-[9px]">Difficulty</div><div className="text-fg">{difficultyLabel(o.difficulty)}</div></div>
                  <div><div className="label !text-[9px]">Investment</div><div className="num text-fg">{money(o.investment)}</div></div>
                  <div><div className="label !text-[9px]">Time</div><div className="num text-fg">{months(o.months)}</div></div>
                  <div><div className="label !text-[9px]">Impact</div><div className="num text-fg">{o.impact}/10</div></div>
                </div>
                {o.dependencies.length > 0 && <div className="text-[11px] text-muted">Depends on: {o.dependencies.join(', ')}</div>}
                <div className="flex items-center gap-1.5 text-[10px] text-muted"><StatusBadge status="estimated" /> score {Math.round(o.score)}</div>
              </div>
            )}
          </button>
        ))}
      </Section>
    </>
  );
}

function Overlap() {
  const s = useApp();
  const a = useAnalysis();
  if (!a || !s.data) return null;
  const vName = (id: string) => s.data!.verticals.find((v) => v.id === id)?.name ?? id;
  const focus = (ids: string[], verts: string[]) => { s.setExpanded([...new Set([...s.expanded, ...verts])]); s.requestFit(ids); };
  return (
    <>
      <Section title="Bundled offers" right={<StatusBadge status="estimated" />}>
        {a.bundles.map((b) => (
          <div key={b.id} className="mb-3 border border-line p-3">
            <button onClick={() => focus(b.members.map((m) => m.id), b.verticals)} className="block w-full text-left">
              <div className="flex items-start justify-between gap-2"><span className="text-[13px] text-fg">{b.name}</span><span className="num text-[13px] text-pos">+{money(b.incrementalRevenue)}</span></div>
              <div className="mt-1 text-[11px] text-fg-2">{b.members.map((m) => m.name).join(' + ')}</div>
              <div className="mt-0.5 text-[10px] text-muted">spans {b.verticals.map(vName).join(', ')}</div>
            </button>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div><div className="label !text-[9px]">Buy all today</div><div className="num text-fg">{b.currentAll}</div></div>
              <div><div className="label !text-[9px]">Adoption</div><div className="num text-fg">{pct(b.adoption)}</div></div>
              <div><div className="label !text-[9px]">New buyers</div><div className="num text-fg">{b.newCustomers}</div></div>
              <div><div className="label !text-[9px]">Bundle price</div><div className="num text-fg">{money(b.price)}</div></div>
              <div><div className="label !text-[9px]">Margin</div><div className="num text-fg">{pct(b.margin)}</div></div>
              <div><div className="label !text-[9px]">Strategic</div><div className="num text-fg">{b.strategicValue}/100</div></div>
            </div>
          </div>
        ))}
        {!a.bundles.length && <p className="text-[12px] text-muted">No bundles detected.</p>}
      </Section>
      <Section title="Product combinations" right={<StatusBadge status="estimated" />}>
        <p className="mb-2 text-[11px] text-muted">e.g. {a.offerPairs[0] ? `${a.offerPairs[0].customersA.toLocaleString()} customers buy ${a.offerPairs[0].a.name}; ${pct(a.offerPairs[0].adoption)} estimated adoption of ${a.offerPairs[0].b.name} → ${money(a.offerPairs[0].incrementalRevenue)}/yr.` : ''}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[11px]">
            <thead><tr className="text-left">{['Combination', 'Pen.', 'Overlap', 'Adopt.', 'Revenue', 'Margin', 'Strat.'].map((h) => <th key={h} className="label pb-1.5 pr-2 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {a.offerPairs.map((o) => (
                <tr key={o.id} onClick={() => focus([o.a.id, o.b.id], [o.a.vertical, o.b.vertical])} className="cursor-pointer border-t border-line hover:bg-panel-2">
                  <td className="py-1.5 pr-2 text-fg-2">{o.a.name} + {o.b.name}{o.crossVertical && <span className="ml-1 text-[9px] text-accent">×V</span>}</td>
                  <td className="num pr-2 text-fg">{pct(o.penetration)}</td>
                  <td className="num pr-2 text-fg">{pct(o.customerOverlap)}</td>
                  <td className="num pr-2 text-fg">{pct(o.adoption)}</td>
                  <td className="num pr-2 text-pos">{money(o.incrementalRevenue)}</td>
                  <td className="num pr-2 text-fg">{money(o.incrementalMargin)}</td>
                  <td className="num text-fg">{o.strategicValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted">×V = crosses verticals. Widen the panel for the full table.</p>
      </Section>
    </>
  );
}

const EMPTY: AcquisitionInput = { name: 'Cascade Web Studio', price: 2_400_000, revenue: 1_800_000, ebitda: 340_000, customers: 220, employees: 16, growth: 0.18, services: ['acquisition', 'brand', 'platform'], segments: ['seg-local'], geography: ['Seattle', 'Portland'], infra: ['web', 'crm'] };

/** The example target, shrunk for companies smaller than ~$20M so it is a plausible first deal. */
function exampleTarget(revenue: number): AcquisitionInput {
  const k = Math.min(1, Math.sqrt(Math.max(0, revenue) / 20_000_000));
  const r = (x: number, to: number) => Math.max(to, Math.round((x * k) / to) * to);
  return { ...EMPTY, price: r(EMPTY.price, 5_000), revenue: r(EMPTY.revenue, 5_000), ebitda: r(EMPTY.ebitda, 1_000), customers: r(EMPTY.customers, 1), employees: r(EMPTY.employees, 1) };
}

function Acquisition() {
  const s = useApp();
  const overlay = useAcquisitionOverlay();
  const base = useBaselineAnalysis();
  const [form, setForm] = useState<AcquisitionInput>(() => s.acquisitionDraft ?? { ...exampleTarget(base?.state.revenue ?? 0), segments: s.data?.segments.slice(0, 1).map((g) => g.id) ?? [] });
  const [geo, setGeo] = useState(form.geography.join(', '));
  const set = <K extends keyof AcquisitionInput>(k: K, v: AcquisitionInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleIn = (k: 'services' | 'segments' | 'infra', v: string) => set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);
  const run = () => s.setAcquisitionDraft({ ...form, geography: geo.split(',').map((x) => x.trim()).filter(Boolean) });
  const r = overlay?.analysis;
  const numField = (k: 'price' | 'revenue' | 'ebitda' | 'customers' | 'employees', label: string) => (
    <label className="block">
      <span className="label !text-[9px]">{label}</span>
      <input type="number" value={form[k]} onChange={(e) => set(k, Number(e.target.value))} className="num mt-0.5 w-full border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-line-2" />
    </label>
  );
  const scoreColor = (v: number, invert = false) => ((invert ? 100 - v : v) >= 65 ? 'var(--pos)' : (invert ? 100 - v : v) >= 45 ? 'var(--warning)' : 'var(--neg)');

  return (
    <>
      <Section title="Target" right={<StatusBadge status="user" />}>
        <label className="mb-2 block"><span className="label !text-[9px]">Name</span><input value={form.name} onChange={(e) => set('name', e.target.value)} className="mt-0.5 w-full border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-line-2" /></label>
        <div className="grid grid-cols-3 gap-2">
          {numField('price', 'Purchase price $')}
          {numField('revenue', 'Revenue $')}
          {numField('ebitda', 'EBITDA $')}
          {numField('customers', 'Customers')}
          {numField('employees', 'Employees')}
          <label className="block"><span className="label !text-[9px]">Growth %</span><input type="number" value={Math.round(form.growth * 100)} onChange={(e) => set('growth', Number(e.target.value) / 100)} className="num mt-0.5 w-full border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-line-2" /></label>
        </div>
        <div className="mt-2.5"><span className="label !text-[9px]">Services</span>
          <div className="mt-1 flex flex-wrap gap-1">{ALL_CAPABILITIES.map((c) => <button key={c} onClick={() => toggleIn('services', c)} className={`border px-1.5 py-0.5 text-[10.5px] ${form.services.includes(c) ? 'border-accent text-fg' : 'border-line text-muted hover:text-fg-2'}`}>{c}</button>)}</div>
        </div>
        <div className="mt-2"><span className="label !text-[9px]">Customer segments served</span>
          <div className="mt-1 flex flex-wrap gap-1">{s.data?.segments.map((g) => <button key={g.id} onClick={() => toggleIn('segments', g.id)} className={`border px-1.5 py-0.5 text-[10.5px] ${form.segments.includes(g.id) ? 'border-accent text-fg' : 'border-line text-muted hover:text-fg-2'}`}>{g.name}</button>)}</div>
        </div>
        <div className="mt-2"><span className="label !text-[9px]">Runs on</span>
          <div className="mt-1 flex flex-wrap gap-1">{INFRA_CATEGORIES.map((c) => <button key={c} onClick={() => toggleIn('infra', c)} className={`border px-1.5 py-0.5 text-[10.5px] ${form.infra.includes(c) ? 'border-accent text-fg' : 'border-line text-muted hover:text-fg-2'}`}>{c}</button>)}</div>
        </div>
        <label className="mt-2 block"><span className="label !text-[9px]">Geography (comma-separated)</span><input value={geo} onChange={(e) => setGeo(e.target.value)} className="mt-0.5 w-full border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-line-2" /></label>
        <div className="mt-3 flex gap-2">
          <Btn variant="primary" onClick={run}><Crosshair className="size-3.5" />Overlay on graph</Btn>
          {overlay && <Btn variant="outline" onClick={() => s.saveAcquisition({ ...form, geography: geo.split(',').map((x) => x.trim()).filter(Boolean) })}><Save className="size-3.5" />Save target</Btn>}
          {overlay && <Btn onClick={() => s.setAcquisitionDraft(null)}>Clear</Btn>}
        </div>
      </Section>
      {r && overlay && (
        <>
          <Section title="Fit assessment" right={<StatusBadge status="estimated" />}>
            <div className="mb-3 grid grid-cols-3 gap-3">
              <div><div className="label !text-[9px]">Strategic fit</div><div className="num text-[22px]" style={{ color: scoreColor(r.strategicFit) }}>{r.strategicFit}</div></div>
              <div><div className="label !text-[9px]">Synergy score</div><div className="num text-[22px]" style={{ color: scoreColor(r.synergyScore) }}>{r.synergyScore}</div></div>
              <div><div className="label !text-[9px]">Integration risk</div><div className="num text-[22px]" style={{ color: scoreColor(r.integrationRisk, true) }}>{r.integrationRisk}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Metric size="sm" label="Revenue synergy" value={money(r.revenueSynergy)} status="estimated" />
              <Metric size="sm" label="Cost synergy" value={money(r.costSynergy)} status="estimated" />
              <Metric size="sm" label="EV / EBITDA" value={Number.isFinite(r.evEbitda) ? `${r.evEbitda.toFixed(1)}×` : 'n/a'} status="user" />
              <Metric size="sm" label="Payback" value={Number.isFinite(r.paybackYears) ? `${r.paybackYears.toFixed(1)} yrs` : 'n/a'} status="estimated" />
            </div>
            <p className="mt-3 border-l-2 border-accent pl-2 text-[12px] text-fg">{r.verdict}</p>
          </Section>
          <Section title="Overlap analysis">
            {[['Service overlap', r.serviceOverlap], ['Customer overlap', r.customerOverlap], ['Geographic overlap', r.geographicOverlap], ['Infrastructure overlap', r.infraOverlap], ['Cross-sell potential', r.crossSellPotential]].map(([l, v]) => (
              <div key={l as string} className="mb-1.5 flex items-center gap-2 text-[11px]">
                <span className="w-36 text-muted">{l}</span>
                <div className="h-[5px] flex-1 bg-panel-3"><div className="h-full rounded-r-[2px] bg-fg-2" style={{ width: `${(v as number) * 100}%` }} /></div>
                <span className="num w-9 text-right text-fg">{pct(v as number)}</span>
              </div>
            ))}
            <div className="mt-2 text-[11px] text-muted">Integration complexity: <span className="text-fg">{r.integrationComplexity}</span></div>
            <div className="mt-2 text-[11px] text-muted">Plugs into: {r.connections.slice(0, 4).map((c) => `${s.data!.verticals.find((v) => v.id === c.vertical)?.name} (${c.reasons.join(', ') || 'adjacent'})`).join('; ')}</div>
          </Section>
        </>
      )}
      <Section title={`Saved targets · ${s.acquisitions.length}`}>
        {s.acquisitions.length ? s.acquisitions.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 first:border-t-0">
            <button onClick={() => { setForm(t); setGeo(t.geography.join(', ')); s.setAcquisitionDraft(t); }} className="min-w-0 flex-1 text-left">
              <div className="truncate text-[12px] text-fg-2 hover:text-fg">{t.name}</div>
              <div className="num text-[10px] text-muted">{money(t.price)} · {money(t.revenue)} rev · {money(t.ebitda)} EBITDA</div>
            </button>
            <button onClick={() => t.id && confirm(`Delete the acquisition target “${t.name}”? This cannot be undone.`) && s.deleteAcquisition(t.id)} aria-label="Delete target" className="text-dim hover:text-neg"><Trash2 className="size-3.5" /></button>
          </div>
        )) : <p className="text-[12px] text-muted">Saved targets appear here and can be compared by the AI analyst.</p>}
      </Section>
    </>
  );
}
