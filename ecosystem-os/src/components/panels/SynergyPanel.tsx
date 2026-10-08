'use client';
import { useMemo, useState } from 'react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { assignVerticalColors } from '@/lib/graph/theme';
import { SYNERGY_FACTORS } from '@/lib/analytics/synergy';
import { money, pct, sum } from '@/lib/analytics/format';
import { Metric, Section, StatusBadge } from '@/components/ui/primitives';
import { Heatmap } from '@/components/ui/charts';

export function SynergyPanel() {
  const s = useApp();
  const a = useAnalysis();
  const colors = useMemo(() => (s.data ? assignVerticalColors(s.data.verticals) : {}), [s.data]);
  const [open, setOpen] = useState<string | null>(a?.synergies[0]?.id ?? null);
  if (!a || !s.data) return null;
  const verts = a.state.active.filter((v) => !v.isNew);
  const vName = (id: string) => verts.find((v) => v.id === id)?.v.name ?? id;
  const score = (x: string, y: string) => a.synergies.find((q) => (q.a === x && q.b === y) || (q.a === y && q.b === x))?.score ?? null;

  return (
    <>
      <Section title="Synergy potential" right={<StatusBadge status="estimated" />}>
        <div className="grid grid-cols-3 gap-3">
          <Metric size="sm" label="Revenue synergy" value={money(sum(a.synergies.map((x) => x.incrementalRevenue)))} status="estimated" metric="synergyRevenue" />
          <Metric size="sm" label="Cost synergy" value={money(sum(a.synergies.map((x) => x.costSavings)))} status="estimated" metric="synergyCost" />
          <Metric size="sm" label="Pairs ≥ 60" value={a.synergies.filter((x) => x.score >= 60).length} status="estimated" metric="synergy" />
        </div>
      </Section>
      <Section title="Synergy matrix">
        <Heatmap labels={verts.map((v) => ({ id: v.id, label: v.v.name, color: colors[v.id]?.base }))} values={score} format={(v) => String(v)} onCell={(x, y) => setOpen([x, y].join('__')) } />
        <p className="mt-2 text-[10px] text-muted">Score 0–100. Darker = stronger. The graph draws every pair with its score; the three strongest glow.</p>
      </Section>
      <Section title="Ranked relationships">
        {a.synergies.map((x, i) => {
          const isOpen = open === x.id || open === `${x.b}__${x.a}`;
          return (
            <div key={x.id} className="border-t border-line first:border-t-0">
              <button onClick={() => setOpen(isOpen ? null : x.id)} className="flex w-full items-center gap-2 py-2 text-left">
                <span className="num w-4 text-[10px] text-dim">{i + 1}</span>
                <span className="flex flex-1 items-center gap-1.5 text-[12px] text-fg-2">
                  <span className="size-2 rounded-full" style={{ background: colors[x.a]?.base }} />{vName(x.a)} ↔ <span className="size-2 rounded-full" style={{ background: colors[x.b]?.base }} />{vName(x.b)}
                </span>
                <span className="num text-[13px] text-fg">{x.score}</span>
              </button>
              {isOpen && (
                <div className="fade-in pb-3 pl-6">
                  <div className="mb-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-muted">Incremental revenue </span><span className="num text-pos">{money(x.incrementalRevenue)}</span></div>
                    <div><span className="text-muted">Cost savings </span><span className="num text-pos">{money(x.costSavings)}</span></div>
                    <div><span className="text-muted">Shared customers </span><span className="num text-fg">{x.pair.sharedCustomers}</span></div>
                    <div><span className="text-muted">Cross-sell </span><span className="num text-fg">{pct(x.pair.currentCrossSellRate)} → {pct(x.pair.targetCrossSellRate)}</span></div>
                  </div>
                  <div className="space-y-1">
                    {SYNERGY_FACTORS.map((f) => (
                      <div key={f.key} className="flex items-center gap-2 text-[10.5px]">
                        <span className="w-32 truncate text-muted">{f.label}</span>
                        <div className="h-[4px] flex-1 bg-panel-3"><div className="h-full bg-[#3987e5]" style={{ width: `${x.factors[f.key] * 100}%` }} /></div>
                        <span className="num w-14 text-right text-fg-2">{Math.round(x.factors[f.key] * f.weight * 100)}/{Math.round(f.weight * 100)}</span>
                      </div>
                    ))}
                  </div>
                  {x.pair.partnership && <p className="mt-2 text-[11px] text-fg-2">Partnership: {x.pair.partnership}</p>}
                  {x.pair.dependency && <p className="mt-1 text-[11px] text-fg-2">Dependency: {x.pair.dependency.note}</p>}
                  <button onClick={() => s.requestFit([x.a, x.b])} className="mt-2 text-[11px] text-accent">Show on graph →</button>
                </div>
              )}
            </div>
          );
        })}
      </Section>
      <Section title="Natural bundles" right={<StatusBadge status="estimated" />}>
        {a.bundles.length ? a.bundles.map((b) => (
          <button key={b.id} onClick={() => { s.setExpanded([...new Set([...s.expanded, ...b.verticals])]); s.requestFit(b.members.map((m) => m.id)); }} className="mb-2 block w-full border border-line p-2.5 text-left hover:border-line-2">
            <div className="flex justify-between text-[12px]"><span className="text-fg">{b.name}</span><span className="num text-pos">+{money(b.incrementalRevenue)}</span></div>
            <div className="mt-0.5 text-[11px] text-muted">{b.members.map((m) => m.name).join(' + ')} · {money(b.price)}/yr · ~{b.newCustomers} adopters</div>
          </button>
        )) : <p className="text-[12px] text-muted">No product groups with strong enough mutual affinity.</p>}
      </Section>
    </>
  );
}
