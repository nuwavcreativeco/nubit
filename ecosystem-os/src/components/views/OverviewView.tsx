'use client';
import { useMemo } from 'react';
import { ArrowUpRight, TriangleAlert, Sparkles } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { executiveAnswers } from '@/lib/analytics/insights';
import { assignVerticalColors } from '@/lib/graph/theme';
import { money, num, pct } from '@/lib/analytics/format';
import { periodStatus } from '@/lib/domain/provenance';
import { Metric, Panel, SeverityTag, StatusBadge } from '@/components/ui/primitives';
import { BarList, ScoreGauge } from '@/components/ui/charts';

export function OverviewView() {
  const s = useApp();
  const a = useAnalysis();
  const colors = useMemo(() => (s.data ? assignVerticalColors(s.data.verticals) : {}), [s.data]);
  if (!a || !s.data) return null;
  const st = a.state;
  const ps = periodStatus(a.status);
  const answers = executiveAnswers(s.data, a);
  const show = (ids: string[]) => { s.setView('graph'); if (ids[0]) s.select(ids[0]); s.requestFit(ids.length ? ids : null); };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-line px-6 py-4">
        <div className="label">Executive overview · {s.year}{a.status.isProjected ? ' · projected' : ''}</div>
        <h1 className="mt-1 text-[20px] font-medium text-fg">{s.data.parent.name}</h1>
        <p className="text-[12px] text-muted">{s.data.parent.tagline}. Ten questions an owner should be able to answer about the business — each answer is computed from the graph.</p>
      </div>
      <div className="grid grid-cols-2 border-b border-line sm:grid-cols-3 lg:grid-cols-6">
        {[
          <Metric key="r" label="Revenue" value={money(st.revenue)} status={ps} metric="revenue" sub={`${pct(st.growth, { sign: true, digits: 1 })} YoY`} />,
          <Metric key="e" label="EBITDA" value={money(st.ebitda)} status={ps} metric="ebitda" sub={`${pct(st.ebitdaMargin)} margin`} />,
          <Metric key="g" label="Gross profit" value={money(st.grossProfit)} status={ps} metric="grossProfit" />,
          <Metric key="c" label="Customers" value={num(st.customers)} status={ps} />,
          <Metric key="rr" label="Recurring" value={pct(st.recurringShare)} status={ps} metric="recurring" sub={money(st.recurringRevenue)} />,
          <Metric key="v" label="Enterprise value" value={money(a.valuation.ev)} status="estimated" metric="valuation" sub={`${a.valuation.multiple.toFixed(1)}× EBITDA`} />,
        ].map((m, i) => <div key={i} className="border-r border-line px-5 py-3.5 last:border-r-0">{m}</div>)}
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_340px]">
        <div className="grid border-line md:grid-cols-2 lg:border-r">
          {answers.map((q, i) => (
            <div key={q.id} className={`border-b border-line p-5 ${i % 2 === 0 ? 'border-r' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="num text-[10px] text-dim">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted">{q.question}</h3>
                </div>
                {q.tone === 'warning' ? <TriangleAlert className="size-3.5" style={{ color: 'var(--warning)' }} /> : <Sparkles className="size-3.5 text-pos" />}
              </div>
              <p className="mt-2 text-[14px] leading-snug text-fg">{q.answer}</p>
              <ul className="mt-2 space-y-0.5">
                {q.detail.map((d) => <li key={d} className="text-[11.5px] leading-snug text-fg-2">· {d}</li>)}
              </ul>
              <div className="mt-2.5 flex items-center justify-between">
                <StatusBadge status="estimated" />
                {q.nodeIds.length > 0 && <button onClick={() => show(q.nodeIds)} className="flex items-center gap-1 text-[11px] text-fg-2 hover:text-accent">Show on graph <ArrowUpRight className="size-3" /></button>}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-0">
          <div className="border-b border-line p-5">
            <div className="label mb-3 flex items-center gap-2">Business health <StatusBadge status="estimated" /></div>
            <div className="flex items-center gap-4">
              <ScoreGauge score={a.health.score} label={a.health.grade} />
              <div className="flex-1 space-y-1">
                {a.health.components.map((c) => (
                  <div key={c.key} className="flex items-center gap-2 text-[10.5px]" title={c.why}>
                    <span className="w-24 truncate text-muted">{c.label}</span>
                    <div className="h-[4px] flex-1 bg-panel-3"><div className="h-full" style={{ width: `${c.score}%`, background: c.score >= 70 ? 'var(--pos)' : c.score >= 45 ? 'var(--warning)' : 'var(--neg)' }} /></div>
                    <span className="num w-6 text-right text-fg-2">{c.score}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 space-y-1.5 text-[11.5px]">
              <div className="label !text-[9px]">Why this score</div>
              {a.health.strengths.map((c) => <div key={c.key} className="text-fg-2"><span className="text-pos">▲</span> {c.label}: {c.why}</div>)}
              {a.health.drags.map((c) => <div key={c.key} className="text-fg-2"><span className="text-neg">▼</span> {c.label}: {c.why}</div>)}
            </div>
          </div>
          <div className="border-b border-line p-5">
            <div className="label mb-3">EBITDA by vertical</div>
            <BarList format={money} items={[...st.active].sort((x, y) => y.ebitda - x.ebitda).map((v) => ({ id: v.id, label: v.v.name, value: v.ebitda, color: colors[v.id]?.base ?? 'var(--accent)', sub: `${pct(v.ebitdaMargin)} margin · ${pct(v.revenue / st.revenue)} of revenue`, onClick: () => show([v.id]) }))} />
          </div>
          <div className="border-b border-line p-5">
            <div className="label mb-3">Top bottlenecks</div>
            {a.bottlenecks.slice(0, 5).map((b) => (
              <button key={b.id} onClick={() => { s.setView('risk'); s.select(b.nodeId, { focus: true }); }} className="mb-2 block w-full text-left">
                <div className="flex justify-between gap-2 text-[12px]"><span className="text-fg-2">{b.title}</span><SeverityTag severity={b.severity} /></div>
              </button>
            ))}
          </div>
          <div className="p-5">
            <div className="label mb-3">Top opportunities</div>
            {a.opportunities.slice(0, 5).map((o) => (
              <button key={o.id} onClick={() => { s.setView('opportunities'); if (o.nodeIds[0]) s.select(o.nodeIds[0]); s.requestFit(o.nodeIds); }} className="mb-2 flex w-full justify-between gap-2 text-left text-[12px]">
                <span className="text-fg-2">{o.name}</span><span className="num shrink-0 text-pos">{money(o.revenue || o.profit)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
