'use client';
import { useMemo } from 'react';
import { Route, Sparkles, TriangleAlert, Info } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { assignVerticalColors } from '@/lib/graph/theme';
import { investorInsights } from '@/lib/analytics/insights';
import { computeState } from '@/lib/analytics/model';
import { money, num, pct, sum } from '@/lib/analytics/format';
import { periodStatus } from '@/lib/domain/provenance';
import { Metric, Section, StatusBadge } from '@/components/ui/primitives';
import { BarList, Heatmap, MixBar, YearColumns } from '@/components/ui/charts';

function useColors() {
  const data = useApp((s) => s.data);
  return useMemo(() => (data ? assignVerticalColors(data.verticals) : {}), [data]);
}

export function EcosystemPanel() {
  const s = useApp();
  const a = useAnalysis();
  const colors = useColors();
  if (!a || !s.data) return null;
  const st = a.state;
  const ps = periodStatus(a.status);
  const insights = investorInsights(s.data, a);
  return (
    <>
      <Section title={`${s.data.parent.name} · ${s.year}`}>
        <div className="grid grid-cols-3 gap-3">
          <Metric size="sm" label="Revenue" value={money(st.revenue)} status={ps} metric="revenue" />
          <Metric size="sm" label="EBITDA" value={money(st.ebitda)} status={ps} metric="ebitda" />
          <Metric size="sm" label="Customers" value={num(st.customers)} status={ps} />
        </div>
      </Section>
      <Section title="Verticals" right={<span className="text-[10px] text-muted">click to open</span>}>
        <table className="w-full text-[12px]">
          <thead><tr className="text-left"><th className="label pb-1.5 font-normal">Vertical</th><th className="label pb-1.5 text-right font-normal">Rev</th><th className="label pb-1.5 text-right font-normal">YoY</th><th className="label pb-1.5 text-right font-normal">EBITDA%</th></tr></thead>
          <tbody>
            {[...st.active].sort((x, y) => y.revenue - x.revenue).map((v) => (
              <tr key={v.id} onClick={() => s.select(v.id, { focus: true })} className={`cursor-pointer border-t border-line hover:bg-panel-2 ${s.selectedId === v.id ? 'bg-panel-2' : ''}`}>
                <td className="py-1.5"><span className="flex items-center gap-2 text-fg-2"><span className="size-2 rounded-full" style={{ background: colors[v.id]?.base ?? 'var(--accent)' }} />{v.v.name}{v.isNew && <StatusBadge status="user" />}</span></td>
                <td className="num py-1.5 text-right text-fg">{money(v.revenue)}</td>
                <td className="num py-1.5 text-right" style={{ color: v.growth >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{v.prevRevenue ? pct(v.growth, { sign: true }) : 'new'}</td>
                <td className="num py-1.5 text-right text-fg-2">{pct(v.ebitdaMargin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="What the graph is telling you" right={<StatusBadge status="estimated" />}>
        <ul className="space-y-2">
          {insights.slice(0, 6).map((i) => (
            <li key={i.id}>
              <button onClick={() => i.nodeIds[0] && s.select(i.nodeIds[0], { focus: true })} className="flex gap-2 text-left text-[12px] leading-snug text-fg-2 hover:text-fg">
                {i.tone === 'warning' ? <TriangleAlert className="mt-0.5 size-3 shrink-0" style={{ color: 'var(--warning)' }} /> : i.tone === 'positive' ? <Sparkles className="mt-0.5 size-3 shrink-0 text-pos" /> : <Info className="mt-0.5 size-3 shrink-0 text-muted" />}
                {i.text}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="How to read this">
        <ul className="space-y-1 text-[11.5px] text-muted">
          <li>Click a vertical to open its internal ecosystem; click again to collapse.</li>
          <li>Hover any node or connection to trace its relationships.</li>
          <li>Switch modes and the flow metric in the bottom bar; scrub years in the top bar.</li>
          <li>Every number carries ACT / EST / PROJ — click it for the formula.</li>
        </ul>
      </Section>
    </>
  );
}

export function RevenuePanel() {
  const s = useApp();
  const a = useAnalysis();
  const colors = useColors();
  const series = useMemo(() => {
    if (!s.data || !s.scenario || !s.baseline) return [];
    return s.data.parent.years.map((y) => ({ year: y, value: computeState(s.data!, y, s.scenario!, s.baseline!).revenue, base: computeState(s.data!, y, s.baseline!, s.baseline!).revenue, projected: y > s.data!.parent.currentYear }));
  }, [s.data, s.scenario, s.baseline]);
  if (!a || !s.data) return null;
  const st = a.state;
  const ps = periodStatus(a.status);
  const flows = s.data.pairs.filter((p) => p.revenueFlow && st.verticals.find((v) => v.id === p.a)?.active && st.verticals.find((v) => v.id === p.b)?.active);
  const vName = (id: string) => st.verticals.find((v) => v.id === id)?.v.name ?? id;
  return (
    <>
      <Section title="Revenue mix" right={<StatusBadge status={ps} />}>
        <MixBar format={money} items={st.active.map((v) => ({ id: v.id, label: v.v.name, value: v.revenue, color: colors[v.id]?.base ?? 'var(--accent)' }))} />
      </Section>
      <Section title="Group revenue by year">
        <YearColumns rows={series} format={money} highlight={s.year} />
      </Section>
      <Section title="Where the money comes from">
        <BarList format={money} items={[...st.segments].sort((x, y) => y.revenue - x.revenue).map((g) => ({ id: g.id, label: g.s.name, value: g.revenue, color: 'var(--fg-2)', sub: `${num(g.customers)} customers · ${pct(g.share)} of total`, onClick: () => s.select(g.id, { focus: true }) }))} />
      </Section>
      <Section title="Money moving between verticals">
        {flows.length ? flows.map((p) => (
          <div key={p.a + p.b} className="mb-2 last:mb-0">
            <div className="flex justify-between text-[12px]"><span className="text-fg-2">{vName(p.revenueFlow!.from)} → {vName(p.revenueFlow!.to)}</span><span className="num text-[#E5C26B]">{money(p.revenueFlow!.amount)}/yr</span></div>
            <div className="text-[11px] text-muted">{p.revenueFlow!.note} <StatusBadge status="actual" /></div>
          </div>
        )) : <p className="text-[12px] text-muted">No inter-vertical flows recorded.</p>}
      </Section>
      <Section title="Customer journeys" right={s.journeyId && <button onClick={() => s.setJourney(null)} className="text-[11px] text-muted hover:text-fg">clear</button>}>
        {s.data.journeys.length ? s.data.journeys.map((j) => (
          <button key={j.id} onClick={() => { s.setJourney(s.journeyId === j.id ? null : j.id); s.requestFit(j.steps); }} className={`mb-1.5 block w-full border px-2.5 py-2 text-left ${s.journeyId === j.id ? 'border-fg-2 bg-panel-2' : 'border-line hover:border-line-2'}`}>
            <div className="flex items-center gap-1.5 text-[12px] text-fg"><Route className="size-3 text-muted" />{j.name}</div>
            <div className="mt-0.5 text-[11px] text-muted">{num(j.customers)} customers · <span className="num">{money(j.revenue)}</span>/yr · {j.steps.length} steps</div>
          </button>
        )) : <p className="text-[12px] text-muted">No journeys defined in this dataset.</p>}
      </Section>
      <Section title="Recurring vs one-time">
        <div className="grid grid-cols-2 gap-3">
          <Metric size="sm" label="Recurring" value={money(st.recurringRevenue)} status={ps} metric="recurring" sub={pct(st.recurringShare)} />
          <Metric size="sm" label="One-time" value={money(st.revenue - st.recurringRevenue)} status={ps} metric="oneTime" sub={pct(1 - st.recurringShare)} />
        </div>
      </Section>
    </>
  );
}

export function CustomersPanel() {
  const s = useApp();
  const a = useAnalysis();
  const colors = useColors();
  if (!a || !s.data) return null;
  const st = a.state;
  const ps = periodStatus(a.status);
  const verts = st.active.filter((v) => !v.isNew);
  const overlap = (x: string, y: string) => {
    const syn = a.synergies.find((q) => (q.a === x && q.b === y) || (q.a === y && q.b === x));
    if (!syn) return null;
    return syn.a === x ? syn.overlapPctA : syn.overlapPctB; // share of row vertical's customers also buying from column
  };
  const top = [...st.segments].sort((x, y) => y.share - x.share)[0];
  return (
    <>
      <Section title="Customer base">
        <div className="grid grid-cols-3 gap-3">
          <Metric size="sm" label="Customers" value={num(st.customers)} status={ps} />
          <Metric size="sm" label="Segments" value={st.segments.length} status="actual" />
          <Metric size="sm" label="Top segment" value={pct(top?.share ?? 0)} status={ps} sub={top?.s.name} />
        </div>
      </Section>
      <Section title="Segments">
        <table className="w-full text-[12px]">
          <thead><tr className="text-left"><th className="label pb-1.5 font-normal">Segment</th><th className="label pb-1.5 text-right font-normal">Cust.</th><th className="label pb-1.5 text-right font-normal">Share</th><th className="label pb-1.5 text-right font-normal">Ret.</th><th className="label pb-1.5 text-right font-normal">Vert.</th></tr></thead>
          <tbody>
            {[...st.segments].sort((x, y) => y.revenue - x.revenue).map((g) => (
              <tr key={g.id} onClick={() => s.select(g.id, { focus: true })} className={`cursor-pointer border-t border-line hover:bg-panel-2 ${s.selectedId === g.id ? 'bg-panel-2' : ''}`}>
                <td className="py-1.5 text-fg-2">{g.s.name}</td>
                <td className="num py-1.5 text-right text-fg">{num(g.customers)}</td>
                <td className="num py-1.5 text-right text-fg">{pct(g.share)}</td>
                <td className="num py-1.5 text-right text-fg-2">{pct(g.s.retention)}</td>
                <td className="num py-1.5 text-right text-fg-2">{g.verticals.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Customer overlap" right={<StatusBadge status="actual" />}>
        <p className="mb-2 text-[11px] text-muted">Share of the row vertical&apos;s customers who also buy from the column vertical.</p>
        <Heatmap labels={verts.map((v) => ({ id: v.id, label: v.v.name, color: colors[v.id]?.base }))} values={overlap} format={(v) => pct(v)} onCell={(x) => s.select(x, { focus: true })} />
      </Section>
      <Section title="Who should get the next offer" right={<StatusBadge status="estimated" />}>
        <BarList
          format={(v) => num(v)}
          items={[...st.segments].filter((g) => g.s.b2b).sort((x, y) => y.customers * y.s.crossSellPotential - x.customers * x.s.crossSellPotential).slice(0, 5).map((g) => ({
            id: g.id, label: g.s.name, value: Math.round(g.customers * g.s.crossSellPotential), color: 'var(--st-estimated)',
            sub: `${pct(g.s.crossSellPotential)} cross-sell potential · buys from ${g.verticals.length} of ${verts.length} verticals`, onClick: () => s.select(g.id, { focus: true }),
          }))}
        />
        <p className="mt-2 text-[10px] text-muted">Bar = customers × cross-sell potential (likely adopters).</p>
      </Section>
      <Section title="Revenue concentration">
        <div className="text-[12px] text-fg-2">Top 2 segments: <span className="num text-fg">{pct(sum([...st.segments].sort((x, y) => y.share - x.share).slice(0, 2).map((g) => g.share)))}</span> of revenue · largest single customer <span className="num text-fg">{pct(s.data.parent.topCustomerShare)}</span> <StatusBadge status="actual" /></div>
      </Section>
    </>
  );
}
