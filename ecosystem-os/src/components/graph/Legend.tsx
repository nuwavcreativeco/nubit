'use client';
import { useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { assignVerticalColors, EDGE_STYLES, MODES, type EdgeKind } from '@/lib/graph/theme';
import type { NodeKind } from '@/lib/domain/types';

const SHAPES: { kind: NodeKind; label: string; shape: React.ReactNode }[] = [
  { kind: 'vertical', label: 'Vertical', shape: <span className="size-3 rounded-full border-2 border-fg-2" /> },
  { kind: 'product', label: 'Product / service', shape: <span className="h-2.5 w-4 rounded-full border border-fg-2" /> },
  { kind: 'segment', label: 'Customer segment', shape: <span className="size-3 bg-fg-2" style={{ clipPath: 'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)' }} /> },
  { kind: 'infra', label: 'Infrastructure', shape: <span className="size-2.5 rotate-45 border border-fg-2" /> },
  { kind: 'function', label: 'Shared team', shape: <span className="size-2.5 border border-dashed border-fg-2" /> },
];

function EdgeSwatch({ kind }: { kind: EdgeKind }) {
  const st = EDGE_STYLES[kind];
  return (
    <svg width="26" height="8" className="shrink-0">
      <line x1="1" y1="4" x2="25" y2="4" stroke={st.color} strokeWidth="2" strokeDasharray={st.dash} />
      {st.flow && <circle cx="17" cy="4" r="2.2" fill={st.color} />}
      {st.arrow && <path d="M 19 1 L 25 4 L 19 7 Z" fill={st.color} />}
    </svg>
  );
}

export function Legend() {
  const s = useApp();
  const a = useAnalysis();
  const [more, setMore] = useState(false);
  if (!s.showLegend) {
    return (
      <button onClick={s.toggleLegend} className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 border border-line bg-panel/95 px-2.5 py-1.5 text-[11px] text-fg-2 hover:text-fg">
        <Eye className="size-3" /> Legend
      </button>
    );
  }
  const edgeKinds = MODES[s.mode].edges.filter((k) => k !== 'ownership');
  const colors = s.data ? assignVerticalColors(s.data.verticals) : {};
  const active = a?.state.active.filter((v) => !v.isNew) ?? [];
  return (
    <div className="absolute bottom-3 left-3 z-10 max-h-[calc(100%-24px)] w-[228px] overflow-y-auto border border-line bg-panel/95 backdrop-blur-sm">
      <div className="flex h-8 items-center justify-between border-b border-line px-3">
        <span className="label !text-fg-2">Legend · {MODES[s.mode].label}</span>
        <button onClick={s.toggleLegend} aria-label="Hide legend" className="text-muted hover:text-fg"><ChevronDown className="size-3.5" /></button>
      </div>
      <div className="space-y-3 p-3">
        {more && <div>
          <div className="label mb-1.5">Verticals · click to filter</div>
          <div className="space-y-1">
            {active.map((v) => {
              const off = s.verticalFilter.size > 0 && !s.verticalFilter.has(v.id);
              return (
                <button key={v.id} onClick={() => s.toggleVerticalFilter(v.id)} className={`flex w-full items-center gap-2 text-left text-[11px] ${off ? 'text-dim' : 'text-fg-2 hover:text-fg'}`}>
                  <span className="size-2.5 rounded-full" style={{ background: off ? 'var(--line-2)' : colors[v.id]?.base }} />
                  {v.v.name}
                </button>
              );
            })}
          </div>
        </div>}
        <div>
          <div className="label mb-1.5">Relationships · click to hide</div>
          <div className="space-y-1">
            {edgeKinds.map((k) => {
              const off = s.hiddenEdges.has(k);
              return (
                <button key={k} onClick={() => s.toggleEdge(k)} title={EDGE_STYLES[k].description} className={`flex w-full items-center gap-2 text-left text-[11px] ${off ? 'text-dim line-through' : 'text-fg-2 hover:text-fg'}`}>
                  <EdgeSwatch kind={k} />
                  <span className="flex-1">{EDGE_STYLES[k].label}</span>
                  {off ? <EyeOff className="size-3" /> : null}
                </button>
              );
            })}
          </div>
        </div>
        {more && <><div>
          <div className="label mb-1.5">Nodes · click to hide</div>
          <div className="space-y-1">
            {SHAPES.map((sh) => {
              const off = s.hiddenKinds.has(sh.kind);
              return (
                <button key={sh.kind} disabled={sh.kind === 'vertical'} onClick={() => s.toggleKind(sh.kind)} className={`flex w-full items-center gap-2 text-left text-[11px] ${off ? 'text-dim line-through' : 'text-fg-2 enabled:hover:text-fg'}`}>
                  <span className="grid w-[26px] place-items-center">{sh.shape}</span>{sh.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1 text-[11px] text-fg-2">
          <div className="label mb-1.5">Signals</div>
          <div className="flex items-center gap-2"><span className="grid w-[26px] place-items-center"><span className="size-3 rounded-full border-2" style={{ borderColor: 'var(--pos)', borderLeftColor: 'var(--line)', borderBottomColor: 'var(--line)' }} /></span>Ring = YoY growth (red = decline)</div>
          <div className="flex items-center gap-2"><span className="grid w-[26px] place-items-center"><span className="size-3 rounded-full" style={{ boxShadow: '0 0 8px 3px color-mix(in oklch, var(--critical) 50%, transparent)' }} /></span>Glow = bottleneck severity</div>
          <div className="flex items-center gap-2"><span className="grid w-[26px] place-items-center"><span className="size-3 rounded-full border border-dashed border-fg-2" /></span>Dashed = hypothetical / sunsetting</div>
          <div className="pt-1 text-[10px] text-muted">Size = {s.metric === 'crossSells' ? 'cross-sells' : s.metric}. Zoom out for clusters, in for detail.</div>
        </div></>}
        <button onClick={() => setMore((m) => !m)} className="text-[11px] text-fg-2 hover:text-accent">{more ? 'Less' : 'Filters, shapes & signals…'}</button>
      </div>
    </div>
  );
}
