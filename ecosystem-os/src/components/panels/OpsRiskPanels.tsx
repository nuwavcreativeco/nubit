'use client';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { BOTTLENECK_LABEL, type BottleneckType } from '@/lib/analytics/bottlenecks';
import { money, pct, sum } from '@/lib/analytics/format';
import { Metric, Section, SeverityTag, StatusBadge } from '@/components/ui/primitives';
import { BarList } from '@/components/ui/charts';

export function OperationsPanel() {
  const s = useApp();
  const a = useAnalysis();
  if (!a || !s.data) return null;
  const st = a.state;
  const active = new Set(st.active.map((v) => v.id));
  const revOf = (ids: string[]) => sum(ids.filter((d) => active.has(d)).map((d) => st.verticals.find((v) => v.id === d)!.revenue));
  const infra = [...s.data.infra].sort((x, y) => revOf(y.dependents) - revOf(x.dependents));
  const opsBn = a.bottlenecks.filter((b) => b.type === 'operations' || b.type === 'technology');
  return (
    <>
      <Section title="Shared backbone">
        <div className="grid grid-cols-3 gap-3">
          <Metric size="sm" label="Systems" value={s.data.infra.length} status="actual" />
          <Metric size="sm" label="Infra cost" value={money(sum(s.data.infra.map((i) => i.annualCost)))} status="actual" />
          <Metric size="sm" label="Shared FTE" value={sum(s.data.functions.map((f) => f.fte))} status="actual" />
        </div>
      </Section>
      <Section title="Revenue exposed per system" right={<span className="text-[10px] text-muted">bar = dependent revenue</span>}>
        <BarList
          format={money}
          items={infra.map((i) => ({
            id: i.id, label: <>{i.name}{i.techDebt >= 0.5 && <SeverityTag severity={i.techDebt} />}</>, value: revOf(i.dependents),
            color: i.techDebt >= 0.6 ? 'var(--serious)' : '#7FA3B8', sub: `${i.dependents.filter((d) => active.has(d)).length} verticals · tech debt ${pct(i.techDebt)} · ${money(i.annualCost)}/yr`,
            onClick: () => s.select(i.id, { focus: true }),
          }))}
        />
      </Section>
      <Section title="Shared teams">
        {s.data.functions.map((f) => (
          <button key={f.id} onClick={() => s.select(f.id, { focus: true })} className="mb-2 block w-full text-left">
            <div className="flex justify-between text-[12px]"><span className="text-fg-2">{f.name}</span><span className="num text-fg">{pct(f.utilization)}</span></div>
            <div className="mt-0.5 h-[5px] bg-panel-3"><div className="h-full" style={{ width: `${Math.min(1, f.utilization) * 100}%`, background: f.utilization > 0.85 ? 'var(--serious)' : 'var(--fg-2)' }} /></div>
            <div className="mt-0.5 text-[10px] text-muted">{f.fte} FTE · serves {f.serves.length} verticals · {money(f.annualCost)}/yr</div>
          </button>
        ))}
      </Section>
      <Section title="Delivery capacity by vertical" right={<StatusBadge status="actual" />}>
        <BarList format={(v) => pct(v)} max={1} items={[...st.active].filter((v) => !v.isNew).sort((x, y) => y.v.ops.utilization - x.v.ops.utilization).map((v) => ({ id: v.id, label: v.v.name, value: v.v.ops.utilization, color: v.v.ops.utilization > 0.85 ? 'var(--serious)' : 'var(--fg-2)', onClick: () => s.select(v.id, { focus: true }) }))} />
      </Section>
      <Section title="Operational bottlenecks">
        {opsBn.map((b) => (
          <button key={b.id} onClick={() => s.select(b.nodeId, { focus: true })} className="mb-2 block w-full text-left">
            <div className="flex justify-between gap-2 text-[12px]"><span className="text-fg">{b.title}</span><SeverityTag severity={b.severity} /></div>
            <div className="text-[11px] text-muted">{b.fix}</div>
          </button>
        ))}
      </Section>
    </>
  );
}

const TYPES: BottleneckType[] = ['customer', 'personnel', 'operations', 'technology', 'sales', 'financial'];

export function RiskPanel() {
  const s = useApp();
  const a = useAnalysis();
  if (!a || !s.data) return null;
  const st = a.state;
  const byType = (t: BottleneckType) => a.bottlenecks.filter((b) => b.type === t);
  const topSeg = [...st.segments].sort((x, y) => y.share - x.share)[0];
  const topV = [...st.active].sort((x, y) => y.revenue - x.revenue)[0];
  return (
    <>
      <Section title="Exposure" right={<StatusBadge status="estimated" />}>
        <div className="grid grid-cols-3 gap-3">
          <Metric size="sm" label="Critical" value={a.bottlenecks.filter((b) => b.severity >= 0.75).length} status="estimated" metric="riskScore" />
          <Metric size="sm" label="Top segment" value={pct(topSeg?.share ?? 0)} status="actual" sub={topSeg?.s.name} />
          <Metric size="sm" label="Top vertical" value={pct(topV ? topV.revenue / st.revenue : 0)} status="actual" sub={topV?.v.name} />
        </div>
      </Section>
      <Section title="Severity by type">
        <div className="grid grid-cols-6 gap-1">
          {TYPES.map((t) => {
            const list = byType(t);
            const max = Math.max(0, ...list.map((b) => b.severity));
            return (
              <div key={t} className="text-center">
                <div className="mx-auto mb-1 grid h-10 place-items-center text-[11px] num" style={{ background: max ? `color-mix(in oklch, var(--critical) ${Math.round(10 + max * 70)}%, var(--panel-2))` : 'var(--panel-2)', color: 'var(--fg)' }}>{list.length}</div>
                <div className="text-[9px] text-muted">{BOTTLENECK_LABEL[t]}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-muted">Cell = count; shade = worst severity.</p>
      </Section>
      {TYPES.map((t) => byType(t).length > 0 && (
        <Section key={t} title={`${BOTTLENECK_LABEL[t]} bottlenecks`}>
          {byType(t).map((b) => (
            <button key={b.id} onClick={() => s.select(b.nodeId, { focus: true })} className={`mb-2.5 block w-full border-l-2 pl-2.5 text-left last:mb-0 ${s.selectedId === b.nodeId ? 'bg-panel-2' : ''}`} style={{ borderColor: b.severity >= 0.75 ? 'var(--critical)' : b.severity >= 0.5 ? 'var(--serious)' : 'var(--warning)' }}>
              <div className="flex justify-between gap-2 text-[12px]"><span className="text-fg">{b.title}</span><SeverityTag severity={b.severity} /></div>
              <div className="mt-0.5 text-[11px] text-muted">{b.detail}</div>
              <div className="mt-0.5 text-[11px] text-fg-2">→ {b.fix}</div>
            </button>
          ))}
        </Section>
      ))}
      <Section title="Stated risks">
        {st.active.filter((v) => v.v.risks.length && !v.isNew).map((v) => (
          <div key={v.id} className="mb-2"><div className="text-[11px] text-muted">{v.v.name}</div>{v.v.risks.map((r) => <div key={r} className="text-[12px] text-fg-2">· {r}</div>)}</div>
        ))}
      </Section>
    </>
  );
}
