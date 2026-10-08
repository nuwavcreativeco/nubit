'use client';
import { useMemo } from 'react';
import { Network, Sparkles, TriangleAlert, Info, FileText } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { investorInsights, strategicMoat } from '@/lib/analytics/insights';
import { projections } from '@/lib/analytics/whatif';
import { assignVerticalColors } from '@/lib/graph/theme';
import { money, pct, sum } from '@/lib/analytics/format';
import { periodStatus } from '@/lib/domain/provenance';
import { Btn, Metric, StatusBadge } from '@/components/ui/primitives';
import { MixBar, YearColumns } from '@/components/ui/charts';

export function InvestorView() {
  const s = useApp();
  const a = useAnalysis();
  const colors = useMemo(() => (s.data ? assignVerticalColors(s.data.verticals) : {}), [s.data]);
  const proj = useMemo(() => (s.data && s.scenario && s.baseline ? projections(s.data, s.scenario, s.baseline) : []), [s.data, s.scenario, s.baseline]);
  if (!a || !s.data) return null;
  const st = a.state;
  const ps = periodStatus(a.status);
  const verts = st.active.filter((v) => !v.isNew);
  const shares = st.active.map((v) => v.revenue / st.revenue);
  const effective = 1 / sum(shares.map((x) => x * x));
  const topSeg = [...st.segments].sort((x, y) => y.share - x.share)[0];
  const insights = investorInsights(s.data, a);
  const moat = strategicMoat(s.data, a);
  const crossSell = sum(a.synergies.map((x) => x.incrementalRevenue));
  const capital = sum(verts.map((v) => v.v.requiredInvestment));
  const topOpps = a.opportunities.slice(0, 6);
  const oppCapital = sum(topOpps.map((o) => o.investment));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-end justify-between border-b border-line px-6 py-4">
        <div>
          <div className="label">Investor view · {s.year}</div>
          <h1 className="mt-1 text-[20px] font-medium text-fg">{s.data.parent.name} — investment thesis</h1>
          <p className="text-[12px] text-muted">Value creation and scalability. Statements below are generated from the data, not written by hand.</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="outline" onClick={() => { s.setView('graph'); s.setMode('investor'); }}><Network className="size-3.5" />Investor graph</Btn>
          <Btn variant="primary" onClick={() => window.open(`/report/investor?company=${s.companyId}&year=${s.year}&scenario=${encodeURIComponent(JSON.stringify(s.scenario))}`, '_blank')}><FileText className="size-3.5" />Investor report</Btn>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-line">
        {[
          <Metric key="1" label="Revenue" value={money(st.revenue)} status={ps} metric="revenue" sub={`${pct(st.growth, { sign: true, digits: 1 })} growth`} />,
          <Metric key="2" label="EBITDA" value={money(st.ebitda)} status={ps} metric="ebitda" sub={`${pct(st.ebitdaMargin)} margin`} />,
          <Metric key="3" label="Recurring" value={pct(st.recurringShare)} status={ps} metric="recurring" sub={money(st.recurringRevenue)} />,
          <Metric key="4" label="Concentration" value={pct(topSeg?.share ?? 0)} status={ps} sub={`top segment · top client ${pct(s.data.parent.topCustomerShare)}`} />,
          <Metric key="5" label="Diversification" value={`${effective.toFixed(1)}`} status={ps} sub="effective verticals" />,
          <Metric key="6" label="Combined TAM" value={money(sum(verts.map((v) => v.v.tam)))} status="estimated" metric="tam" />,
          <Metric key="7" label="Valuation" value={money(a.valuation.ev)} status="estimated" metric="valuation" sub={`${a.valuation.multiple.toFixed(1)}× EBITDA`} />,
        ].map((m, i) => <div key={i} className="border-r border-line px-5 py-3.5 last:border-r-0">{m}</div>)}
      </div>

      <div className="grid grid-cols-[1.2fr_1fr]">
        <div className="border-r border-line">
          <div className="border-b border-line p-6">
            <div className="label mb-3 flex items-center gap-2">Investment thesis <StatusBadge status="estimated" /></div>
            <ol className="space-y-3">
              {insights.map((i, k) => (
                <li key={i.id} className="flex gap-3">
                  <span className="num mt-0.5 text-[11px] text-dim">{String(k + 1).padStart(2, '0')}</span>
                  <button onClick={() => { s.setView('graph'); if (i.nodeIds[0]) s.select(i.nodeIds[0]); s.requestFit(i.nodeIds.length ? i.nodeIds : null); }} className="flex flex-1 gap-2 text-left text-[14px] leading-snug text-fg hover:text-accent">
                    {i.tone === 'warning' ? <TriangleAlert className="mt-1 size-3.5 shrink-0" style={{ color: 'var(--warning)' }} /> : i.tone === 'positive' ? <Sparkles className="mt-1 size-3.5 shrink-0 text-pos" /> : <Info className="mt-1 size-3.5 shrink-0 text-muted" />}
                    {i.text}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="grid grid-cols-2">
            <div className="border-r border-line p-6">
              <div className="label mb-3">Strategic moat</div>
              <ul className="space-y-2">{moat.map((m) => <li key={m} className="text-[12.5px] text-fg-2">◆ {m}</li>)}</ul>
            </div>
            <div className="p-6">
              <div className="label mb-3">Key risks</div>
              <ul className="space-y-2">{a.bottlenecks.slice(0, 5).map((b) => <li key={b.id} className="text-[12.5px] text-fg-2"><span style={{ color: b.severity >= 0.75 ? 'var(--critical)' : 'var(--serious)' }}>▲</span> {b.title}</li>)}</ul>
            </div>
          </div>
        </div>

        <div>
          <div className="border-b border-line p-6">
            <div className="label mb-3 flex items-center gap-2">Projected valuation <StatusBadge status="projected" /></div>
            <YearColumns rows={proj.map((p) => ({ year: p.year, value: p.ev, projected: p.kind === 'projected' }))} format={money} highlight={s.year} height={130} />
            <p className="mt-2 text-[10px] text-muted">EV = EBITDA × multiple (growth, recurring share, health). Indicative, not an appraisal.</p>
          </div>
          <div className="border-b border-line p-6">
            <div className="label mb-3">Revenue mix</div>
            <MixBar format={money} items={st.active.map((v) => ({ id: v.id, label: v.v.name, value: v.revenue, color: colors[v.id]?.base ?? '#c4c9d1' }))} />
          </div>
          <div className="grid grid-cols-2 border-b border-line">
            <div className="border-r border-line p-6"><Metric label="Cross-selling potential" value={money(crossSell)} status="estimated" metric="synergyRevenue" sub="incremental annual revenue" /></div>
            <div className="p-6"><Metric label="Capital requirements" value={money(capital + oppCapital)} status="estimated" sub={`${money(capital)} vertical plans + ${money(oppCapital)} top initiatives`} /></div>
          </div>
          <div className="p-6">
            <div className="label mb-3">Growth opportunities</div>
            {topOpps.map((o) => (
              <div key={o.id} className="mb-2 flex justify-between gap-3 text-[12px]">
                <span className="text-fg-2">{o.name}</span>
                <span className="num shrink-0 text-fg">{money(o.revenue || o.profit)} <span className="text-muted">@ {pct(o.confidence)}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
