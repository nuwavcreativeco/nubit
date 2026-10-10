'use client';
import { useEffect, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import type { CompanyData, DataStatus, ScenarioParams } from '@/lib/domain/types';
import { api } from '@/lib/data/client';
import { analyze } from '@/lib/analytics';
import { baselineScenario } from '@/lib/analytics/model';
import { executiveAnswers, investorInsights, strategicMoat } from '@/lib/analytics/insights';
import { projections } from '@/lib/analytics/whatif';
import { OPPORTUNITY_LABEL } from '@/lib/analytics/opportunities';
import { money, num, pct, sum } from '@/lib/analytics/format';
import { assignVerticalColors } from '@/lib/graph/theme';
import { STATUS_LABEL } from '@/lib/domain/provenance';

const Tag = ({ s }: { s: DataStatus }) => <span className="ml-1 border border-neutral-300 px-1 align-middle font-mono text-[8px] tracking-wider text-neutral-500">{STATUS_LABEL[s].toUpperCase()}</span>;

function H({ n, children }: { n: string; children: React.ReactNode }) {
  return <h2 className="mb-3 mt-9 flex items-baseline gap-3 border-b border-neutral-900 pb-1.5 text-[15px] font-semibold text-neutral-900"><span className="font-mono text-[11px] text-neutral-400">{n}</span>{children}</h2>;
}

/** Static ecosystem map for print: parent at the centre, verticals sized by revenue, links weighted by synergy. */
function EcosystemMap({ a, colors }: { a: ReturnType<typeof analyze>; colors: Record<string, { base: string }> }) {
  const verts = a.state.active;
  const W = 520, H = 300, cx = W / 2, cy = H / 2, R = 115;
  const max = Math.max(...verts.map((v) => v.revenue));
  const pos = Object.fromEntries(verts.map((v, i) => { const t = -Math.PI / 2 + (i / verts.length) * Math.PI * 2; return [v.id, { x: cx + R * 1.55 * Math.cos(t), y: cy + R * Math.sin(t) }]; }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {a.synergies.map((x) => pos[x.a] && pos[x.b] && <line key={x.id} x1={pos[x.a].x} y1={pos[x.a].y} x2={pos[x.b].x} y2={pos[x.b].y} stroke="#9a9a9a" strokeWidth={0.5 + (x.score / 100) * 4} opacity={0.25 + x.score / 160} />)}
      {verts.map((v) => <line key={v.id} x1={cx} y1={cy} x2={pos[v.id].x} y2={pos[v.id].y} stroke="#d4d4d4" strokeWidth="1" />)}
      <circle cx={cx} cy={cy} r={26} fill="#111" /><text x={cx} y={cy + 3} textAnchor="middle" fontSize="8" fill="#fff">Group</text>
      {verts.map((v) => { const r = 12 + Math.sqrt(v.revenue / max) * 22; return (
        <g key={v.id}><circle cx={pos[v.id].x} cy={pos[v.id].y} r={r} fill={colors[v.id]?.base ?? '#999'} stroke="#fff" strokeWidth="2" />
          <text x={pos[v.id].x} y={pos[v.id].y + r + 10} textAnchor="middle" fontSize="8.5" fill="#222">{v.v.name}</text>
          <text x={pos[v.id].x} y={pos[v.id].y + r + 20} textAnchor="middle" fontSize="7.5" fill="#666" fontFamily="monospace">{money(v.revenue)}</text></g>); })}
    </svg>
  );
}

export function Report({ kind }: { kind: 'investor' | 'executive' }) {
  const [state, setState] = useState<{ data: CompanyData; year: number; scenario: ScenarioParams } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('company') ?? 'meridian';
    api.company(id).then((data) => {
      const base = baselineScenario(data);
      let scenario = base;
      try { if (q.get('scenario')) scenario = { ...base, ...JSON.parse(q.get('scenario')!) }; } catch { /* ignore malformed */ }
      setState({ data, year: Number(q.get('year') ?? data.parent.currentYear), scenario });
    }).catch((e) => setError(e.message));
  }, []);

  const r = useMemo(() => {
    if (!state) return null;
    const base = baselineScenario(state.data);
    const a = analyze(state.data, state.year, state.scenario, base);
    const scenarioActive = JSON.stringify(state.scenario) !== JSON.stringify(base);
    return { a, base, scenarioActive, proj: projections(state.data, state.scenario, base), colors: assignVerticalColors(state.data.verticals), insights: investorInsights(state.data, a), moat: strategicMoat(state.data, a), answers: executiveAnswers(state.data, a) };
  }, [state]);

  if (error) return <div className="p-10 text-red-600">{error}</div>;
  if (!state || !r) return <div className="p-10 text-neutral-500">Preparing report…</div>;
  const { data, year } = state;
  const { a } = r;
  const st = a.state;
  const ps: DataStatus = year > data.parent.currentYear || r.scenarioActive ? 'projected' : 'actual';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="h-screen overflow-y-auto bg-neutral-200 print:h-auto print:overflow-visible print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-neutral-300 bg-white px-6 py-2 text-[12px] text-neutral-600">
        <span>{kind === 'investor' ? 'Investor report' : 'Executive / board report'} · use your browser&apos;s “Save as PDF” to export</span>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 bg-neutral-900 px-3 py-1.5 text-white"><Printer className="size-3.5" />Print / PDF</button>
      </div>
      <article className="mx-auto my-8 max-w-[820px] bg-white px-14 py-12 text-[12px] leading-relaxed text-neutral-800 shadow-sm print:my-0 print:max-w-none print:px-0 print:py-0 print:shadow-none" style={{ fontFamily: 'var(--font-plex-sans)' }}>
        <header className="border-b-2 border-neutral-900 pb-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">{kind === 'investor' ? 'Investor memorandum' : 'Board briefing'} · FY{year}{year > data.parent.currentYear ? ' (projected)' : ''}</div>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight text-neutral-950">{data.parent.name}</h1>
          <p className="text-[13px] text-neutral-600">{data.parent.tagline}</p>
          <div className="mt-3 flex gap-6 font-mono text-[10px] text-neutral-500">
            <span>Prepared {today}</span><span>Data: {data.meta.source}, as of {data.meta.asOf}</span><span>{r.scenarioActive ? 'Scenario applied — figures from FY' + data.parent.currentYear + ' are projections' : 'Baseline — no scenario'}</span>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-4 gap-px bg-neutral-300">
          {[
            ['Revenue', money(st.revenue), `${pct(st.growth, { sign: true, digits: 1 })} YoY`, ps],
            ['EBITDA', money(st.ebitda), `${pct(st.ebitdaMargin)} margin`, ps],
            ['Recurring revenue', pct(st.recurringShare), money(st.recurringRevenue), ps],
            ['Enterprise value', money(a.valuation.ev), `${a.valuation.multiple.toFixed(1)}× EBITDA`, 'estimated'],
            ['Customers', num(st.customers), `${st.segments.length} segments`, ps],
            ['Employees', String(st.employees), `${money(st.revenue / st.employees)} / employee`, ps],
            ['Business health', `${a.health.score}/100`, a.health.grade, 'estimated'],
            ['Cross-sell potential', money(sum(a.synergies.map((x) => x.incrementalRevenue))), 'incremental / yr', 'estimated'],
          ].map(([l, v, sub, s]) => (
            <div key={l} className="bg-white p-3"><div className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">{l}<Tag s={s as DataStatus} /></div><div className="mt-1 font-mono text-[18px] text-neutral-950">{v}</div><div className="text-[10px] text-neutral-500">{sub}</div></div>
          ))}
        </section>

        {kind === 'investor' ? (
          <>
            <H n="01">Investment thesis</H>
            <ol className="space-y-2">{r.insights.map((i, k) => <li key={i.id} className="flex gap-3"><span className="font-mono text-neutral-400">{k + 1}.</span><span className="text-[13px] text-neutral-900">{i.text}</span></li>)}</ol>
            <p className="mt-2 text-[10px] text-neutral-500">Statements are generated from the underlying data model; underlying figures are actuals or engine estimates as labelled throughout.</p>

            <H n="02">The ecosystem</H>
            <div className="grid grid-cols-[1.25fr_1fr] gap-6">
              <EcosystemMap a={a} colors={r.colors} />
              <div>
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-neutral-500">Strategic moat</div>
                <ul className="space-y-1.5">{r.moat.map((m) => <li key={m}>◆ {m}</li>)}</ul>
              </div>
            </div>
          </>
        ) : (
          <>
            <H n="01">Ten questions</H>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              {r.answers.map((q, i) => (
                <div key={q.id} className="break-inside-avoid">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">{String(i + 1).padStart(2, '0')} · {q.question}</div>
                  <p className="mt-0.5 text-[12.5px] font-medium text-neutral-900">{q.answer}</p>
                  <ul className="mt-0.5 text-[10.5px] text-neutral-600">{q.detail.slice(0, 3).map((d) => <li key={d}>· {d}</li>)}</ul>
                </div>
              ))}
            </div>
          </>
        )}

        <H n="03">Vertical performance</H>
        <table className="w-full text-[11px]">
          <thead><tr className="border-b border-neutral-400 text-left font-mono text-[9px] uppercase tracking-wider text-neutral-500"><th className="py-1.5">Vertical</th><th className="text-right">Revenue</th><th className="text-right">Share</th><th className="text-right">Growth</th><th className="text-right">Gross margin</th><th className="text-right">EBITDA</th><th className="text-right">Margin</th><th className="text-right">Recurring</th></tr></thead>
          <tbody>
            {[...st.active].sort((x, y) => y.revenue - x.revenue).map((v) => (
              <tr key={v.id} className="border-b border-neutral-200 font-mono">
                <td className="py-1.5 font-sans"><span className="mr-1.5 inline-block size-2" style={{ background: r.colors[v.id]?.base ?? '#999' }} />{v.v.name}</td>
                <td className="text-right">{money(v.revenue)}</td><td className="text-right">{pct(v.revenue / st.revenue)}</td><td className="text-right">{v.prevRevenue ? pct(v.growth, { sign: true }) : 'new'}</td>
                <td className="text-right">{pct(v.v.grossMargin)}</td><td className="text-right">{money(v.ebitda)}</td><td className="text-right">{pct(v.ebitdaMargin)}</td><td className="text-right">{pct(v.v.recurringShare)}</td>
              </tr>
            ))}
            <tr className="font-mono font-semibold"><td className="py-1.5 font-sans">Group</td><td className="text-right">{money(st.revenue)}</td><td className="text-right">100%</td><td className="text-right">{pct(st.growth, { sign: true })}</td><td className="text-right">{pct(st.grossProfit / st.revenue)}</td><td className="text-right">{money(st.ebitda)}</td><td className="text-right">{pct(st.ebitdaMargin)}</td><td className="text-right">{pct(st.recurringShare)}</td></tr>
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-neutral-500">Status: {STATUS_LABEL[ps]}.</p>

        <H n="04">Financial projections</H>
        <table className="w-full text-[11px]">
          <thead><tr className="border-b border-neutral-400 text-left font-mono text-[9px] uppercase tracking-wider text-neutral-500"><th className="py-1.5">Year</th><th>Status</th><th className="text-right">Revenue</th><th className="text-right">Growth</th><th className="text-right">EBITDA</th><th className="text-right">Margin</th><th className="text-right">Customers</th><th className="text-right">EV (est.)</th></tr></thead>
          <tbody>{r.proj.map((p) => (
            <tr key={p.year} className={`border-b border-neutral-200 font-mono ${p.year === year ? 'bg-neutral-100' : ''}`}>
              <td className="py-1.5">{p.year}</td><td className="font-sans text-[10px] uppercase text-neutral-500">{p.kind}</td><td className="text-right">{money(p.revenue)}</td><td className="text-right">{pct(p.growth, { sign: true })}</td><td className="text-right">{money(p.ebitda)}</td><td className="text-right">{pct(p.ebitdaMargin)}</td><td className="text-right">{num(p.customers)}</td><td className="text-right">{money(p.ev)}</td>
            </tr>
          ))}</tbody>
        </table>

        <H n="05">Synergies</H>
        <table className="w-full text-[11px]">
          <thead><tr className="border-b border-neutral-400 text-left font-mono text-[9px] uppercase tracking-wider text-neutral-500"><th className="py-1.5">Relationship</th><th className="text-right">Score</th><th className="text-right">Shared customers</th><th className="text-right">Revenue synergy</th><th className="text-right">Cost synergy</th><th className="pl-3">Drivers</th></tr></thead>
          <tbody>{a.synergies.slice(0, 7).map((x) => (
            <tr key={x.id} className="border-b border-neutral-200"><td className="py-1.5">{st.verticals.find((v) => v.id === x.a)?.v.name} ↔ {st.verticals.find((v) => v.id === x.b)?.v.name}</td><td className="text-right font-mono">{x.score}</td><td className="text-right font-mono">{x.pair.sharedCustomers}</td><td className="text-right font-mono">{money(x.incrementalRevenue)}</td><td className="text-right font-mono">{money(x.costSavings)}</td><td className="pl-3 text-[10px] text-neutral-500">{x.topDrivers.join(', ')}</td></tr>
          ))}</tbody>
        </table>
        <p className="mt-1 text-[10px] text-neutral-500">All synergy values are engine estimates.</p>

        <H n="06">Growth opportunities</H>
        <table className="w-full text-[11px]">
          <thead><tr className="border-b border-neutral-400 text-left font-mono text-[9px] uppercase tracking-wider text-neutral-500"><th className="py-1.5">Opportunity</th><th>Type</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="text-right">Conf.</th><th className="text-right">Invest.</th><th className="text-right">Time</th></tr></thead>
          <tbody>{a.opportunities.slice(0, 10).map((o) => (
            <tr key={o.id} className="border-b border-neutral-200"><td className="py-1.5 pr-2">{o.name}</td><td className="text-[10px] text-neutral-500">{OPPORTUNITY_LABEL[o.type]}</td><td className="text-right font-mono">{money(o.revenue)}</td><td className="text-right font-mono">{money(o.profit)}</td><td className="text-right font-mono">{pct(o.confidence)}</td><td className="text-right font-mono">{money(o.investment)}</td><td className="text-right font-mono">{o.months}mo</td></tr>
          ))}</tbody>
        </table>

        <H n="07">Risks & bottlenecks</H>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
          {a.bottlenecks.slice(0, 8).map((b) => (
            <div key={b.id} className="break-inside-avoid"><div className="text-[11.5px] font-medium text-neutral-900">{b.title} <span className="font-mono text-[10px] text-neutral-500">· severity {Math.round(b.severity * 100)}</span></div><div className="text-[10.5px] text-neutral-600">{b.fix}</div></div>
          ))}
        </div>

        <H n="08">Business health</H>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {a.health.components.map((c) => <div key={c.key} className="flex justify-between border-b border-neutral-100 py-0.5 text-[11px]"><span>{c.label} <span className="text-neutral-400">({Math.round(c.weight * 100)}%)</span></span><span className="font-mono">{c.score}</span></div>)}
        </div>
        <p className="mt-2 text-[11px]">Overall <b>{a.health.score}/100 ({a.health.grade})</b>. Strongest: {a.health.strengths.map((c) => c.label.toLowerCase()).join(', ')}. Weakest: {a.health.drags.map((c) => c.label.toLowerCase()).join(', ')}.</p>

        <H n="09">Methodology & data confidence</H>
        <p className="text-[10.5px] text-neutral-600">
          Every figure is labelled. <b>Actual</b> = reported by the source system for a closed or current period. <b>Estimated</b> = management estimates (TAM, LTV, affinity) and engine-derived values (synergy, opportunities, health, valuation).
          <b> Projected</b> = future periods, or current-period figures under a what-if scenario. Projections compound each vertical&apos;s base growth with a 15%/yr decay. Enterprise value uses an indicative multiple
          (5 + 18 × capped growth + 4 × recurring share + health adjustment) and is not an appraisal.{r.scenarioActive && ` Scenario: customer growth ${pct(state.scenario.customerGrowth, { sign: true })}, pricing ${pct(state.scenario.pricing, { sign: true })}, cross-sell ${pct(state.scenario.crossSellRate, { digits: 1 })}, retention ${pct(state.scenario.retention)}, new vertical ${money(state.scenario.newVertical)}, opex efficiency ${pct(state.scenario.costEfficiency)}.`}
        </p>
        <footer className="mt-10 border-t border-neutral-300 pt-2 font-mono text-[9px] text-neutral-400">Ecosystem OS · {data.parent.name} · generated {today}</footer>
      </article>
    </div>
  );
}
