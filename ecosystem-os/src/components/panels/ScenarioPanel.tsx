'use client';
import { useMemo, useState } from 'react';
import { RotateCcw, Save, Trash2 } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis, useBaselineAnalysis } from '@/store/useAnalysis';
import { milestone, projections } from '@/lib/analytics/whatif';
import { assignVerticalColors } from '@/lib/graph/theme';
import { money, num, pct, sum } from '@/lib/analytics/format';
import type { ScenarioParams } from '@/lib/domain/types';
import { Btn, Metric, Section, Slider, StatusBadge } from '@/components/ui/primitives';
import { MixBar, YearColumns } from '@/components/ui/charts';

interface Lever { key: Exclude<keyof ScenarioParams, 'verticalPlans'>; label: string; min: number; max: number; step: number; presets: number[]; fmt: (v: number) => string }

const LEVERS: Lever[] = [
  { key: 'customerGrowth', label: 'Customer growth', min: -0.2, max: 0.6, step: 0.01, presets: [0.1, 0.25, 0.5], fmt: (v) => pct(v, { sign: true }) },
  { key: 'pricing', label: 'Pricing', min: -0.1, max: 0.25, step: 0.01, presets: [0.05, 0.1, 0.2], fmt: (v) => pct(v, { sign: true }) },
  { key: 'crossSellRate', label: 'Cross-sell rate', min: 0, max: 0.35, step: 0.005, presets: [0.05, 0.1, 0.2, 0.3], fmt: (v) => pct(v, { digits: 1 }) },
  { key: 'retention', label: 'Customer retention', min: 0.55, max: 0.97, step: 0.01, presets: [0.7, 0.8, 0.9], fmt: (v) => pct(v) },
  { key: 'newVertical', label: 'New vertical contribution', min: 0, max: 2_000_000, step: 50_000, presets: [250_000, 500_000, 1_000_000], fmt: (v) => money(v) },
  { key: 'costEfficiency', label: 'Opex efficiency', min: 0, max: 0.2, step: 0.01, presets: [0.05, 0.1], fmt: (v) => pct(v) },
];

export function ScenarioPanel() {
  const s = useApp();
  const a = useAnalysis();
  const base = useBaselineAnalysis();
  const [name, setName] = useState('');
  const colors = useMemo(() => (s.data ? assignVerticalColors(s.data.verticals) : {}), [s.data]);
  const proj = useMemo(() => (s.data && s.scenario && s.baseline ? { sc: projections(s.data, s.scenario, s.baseline), base: projections(s.data, s.baseline, s.baseline) } : null), [s.data, s.scenario, s.baseline]);
  const milestones = useMemo(() => {
    if (!s.data || !s.scenario || !s.baseline) return null;
    const m = (sc: ScenarioParams, k: 'revenue' | 'ebitda') => milestone(s.data!, sc, s.baseline!, k, 1_000_000);
    return { rev: m(s.scenario, 'revenue'), ebitda: m(s.scenario, 'ebitda'), baseRev: m(s.baseline, 'revenue'), baseEbitda: m(s.baseline, 'ebitda') };
  }, [s.data, s.scenario, s.baseline]);
  if (!a || !base || !s.scenario || !s.baseline || !s.data) return null;
  const cur = s.data.parent.currentYear;
  const sc = s.scenario, bl = s.baseline;
  const st = a.state, bst = base.state;
  const d = (x: number, y: number) => (Math.abs(x - y) < 1 ? null : { text: `${x >= y ? '+' : '−'}${money(Math.abs(x - y))}`, good: x >= y });
  const comp = { volume: sum(st.active.map((v) => v.components.volume)), price: sum(st.active.map((v) => v.components.price)), crossSell: sum(st.active.map((v) => v.components.crossSell)), newV: st.active.find((v) => v.isNew)?.revenue ?? 0 };

  return (
    <>
      {s.year < cur && (
        <div className="border-b border-line bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-2 text-[11px] text-fg-2">
          Scenarios apply from {cur} onward — you&apos;re viewing actuals for {s.year}. <button onClick={() => s.setYear(cur)} className="text-accent">Jump to {cur}</button>
        </div>
      )}
      <Section title="Assumptions" right={<button onClick={s.resetScenario} className="flex items-center gap-1 text-[11px] text-muted hover:text-fg"><RotateCcw className="size-3" />Baseline</button>}>
        <div className="space-y-4">
          {LEVERS.map((l) => (
            <div key={l.key}>
              <Slider label={l.label} value={sc[l.key]} min={l.min} max={l.max} step={l.step} onChange={(v) => s.setScenario({ [l.key]: v })} format={l.fmt} baseline={bl[l.key]} />
              <div className="mt-1 flex gap-1">
                {l.presets.map((p) => (
                  <button key={p} onClick={() => s.setScenario({ [l.key]: p })} className={`num border px-1.5 py-px text-[10px] ${Math.abs(sc[l.key] - p) < 1e-9 ? 'border-accent text-fg' : 'border-line text-muted hover:text-fg-2'}`}>{l.fmt(p)}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Business-unit plans" right={<StatusBadge status="user" />}>
        <p className="mb-3 text-[11px] text-muted">Extra annual growth for one unit on top of its base case, starting in a chosen year. Plan growth fades 15% a year, like base growth.</p>
        <div className="space-y-4">
          {s.data.verticals.map((v) => {
            const plan = sc.verticalPlans?.[v.id];
            const g = plan?.extraGrowth ?? 0;
            const start = plan?.startYear ?? cur + 1;
            return (
              <div key={v.id}>
                <div className="mb-1 flex items-center gap-2 text-[12px] text-fg-2"><span className="size-2 rounded-full" style={{ background: colors[v.id]?.base }} />{v.name}</div>
                <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                  <Slider label="Extra growth / yr" value={g} min={-0.5} max={2} step={0.05} onChange={(val) => s.setVerticalPlan(v.id, { extraGrowth: val, startYear: start })} format={(x) => pct(x, { sign: true })} baseline={0} />
                  <label className="block pb-4">
                    <span className="label !text-[9px]">From</span>
                    <select value={start} onChange={(e) => s.setVerticalPlan(v.id, { extraGrowth: g, startYear: Number(e.target.value) })} className="num mt-0.5 block border border-line bg-panel-2 px-1.5 py-1 text-[12px] text-fg outline-none">
                      {s.data!.parent.years.filter((y) => y >= cur).map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      {milestones && (
        <Section title="Milestones" right={<StatusBadge status="projected" />}>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Revenue ≥ $1M" value={milestones.rev ?? `after ${s.data.parent.years.at(-1)}`} status="projected" sub={`baseline: ${milestones.baseRev ?? `after ${s.data.parent.years.at(-1)}`}`} />
            <Metric label="EBITDA ≥ $1M" value={milestones.ebitda ?? `after ${s.data.parent.years.at(-1)}`} status="projected" sub={`baseline: ${milestones.baseEbitda ?? `after ${s.data.parent.years.at(-1)}`}`} />
          </div>
        </Section>
      )}
      <Section title={`Result · ${s.year}`} right={<StatusBadge status={a.scenarioActive ? 'projected' : 'actual'} long />}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Metric label="Revenue" value={money(st.revenue)} status={a.scenarioActive ? 'projected' : 'actual'} metric="revenue" delta={d(st.revenue, bst.revenue)} />
          <Metric label="EBITDA" value={money(st.ebitda)} status={a.scenarioActive ? 'projected' : 'actual'} metric="ebitda" delta={d(st.ebitda, bst.ebitda)} sub={pct(st.ebitdaMargin)} />
          <Metric label="Gross profit" value={money(st.grossProfit)} status={a.scenarioActive ? 'projected' : 'actual'} metric="grossProfit" delta={d(st.grossProfit, bst.grossProfit)} />
          <Metric label="Customers" value={num(st.customers)} status={a.scenarioActive ? 'projected' : 'actual'} sub={st.customers !== bst.customers ? `${st.customers > bst.customers ? '+' : ''}${num(st.customers - bst.customers)} vs baseline` : undefined} />
          <Metric label="Growth rate" value={pct(st.growth, { sign: true, digits: 1 })} status={a.scenarioActive ? 'projected' : 'actual'} metric="growth" sub={`baseline ${pct(bst.growth, { sign: true, digits: 1 })}`} />
          <Metric label="Valuation" value={money(a.valuation.ev)} status="estimated" metric="valuation" delta={d(a.valuation.ev, base.valuation.ev)} sub={`${a.valuation.multiple.toFixed(1)}×`} />
        </div>
      </Section>
      {a.scenarioActive && (
        <Section title="Revenue bridge vs baseline">
          {[['Customer volume & retention', comp.volume], ['Pricing', comp.price], ['Cross-sell', comp.crossSell], ['New vertical', comp.newV]].map(([l, v]) => (
            <div key={l as string} className="flex justify-between py-0.5 text-[12px]"><span className="text-fg-2">{l}</span><span className="num" style={{ color: (v as number) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{(v as number) >= 0 ? '+' : '−'}{money(Math.abs(v as number))}</span></div>
          ))}
        </Section>
      )}
      <Section title="Revenue mix">
        <MixBar format={money} items={st.active.map((v) => ({ id: v.id, label: v.v.name, value: v.revenue, color: colors[v.id]?.base ?? '#c4c9d1' }))} />
      </Section>
      {proj && (
        <Section title="Projection">
          <div className="label mb-1 !text-[9px]">Revenue</div>
          <YearColumns rows={proj.sc.map((p, i) => ({ year: p.year, value: p.revenue, base: proj.base[i].revenue, projected: p.kind === 'projected' }))} format={money} highlight={s.year} />
          <div className="label mb-1 mt-3 !text-[9px]">EBITDA</div>
          <YearColumns height={80} rows={proj.sc.map((p, i) => ({ year: p.year, value: p.ebitda, base: proj.base[i].ebitda, projected: p.kind === 'projected' }))} format={money} highlight={s.year} />
        </Section>
      )}
      <Section title="Save scenario">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aggressive cross-sell 2027" className="min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] text-fg outline-none focus:border-line-2" />
          <Btn variant="outline" disabled={!name.trim() || !a.scenarioActive} onClick={async () => { await s.saveScenario(name.trim()); setName(''); }}><Save className="size-3.5" />Save</Btn>
        </div>
        <div className="mt-2">
          {s.savedScenarios.map((x) => (
            <div key={x.id} className="flex items-center justify-between border-t border-line py-1.5 first:border-t-0">
              <button onClick={() => s.applySavedScenario(x)} className={`text-left text-[12px] ${x.id === s.activeScenarioId ? 'text-accent' : 'text-fg-2 hover:text-fg'}`}>{x.name}</button>
              <button onClick={() => s.deleteScenario(x.id)} aria-label="Delete scenario" className="text-dim hover:text-neg"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
