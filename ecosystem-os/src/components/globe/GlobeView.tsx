'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Color } from 'three';
import { Pause, Play, Tag, Boxes, Sparkles, TriangleAlert, Info, PanelsTopLeft } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { buildGraph, INFRA_CLUSTER, SEGMENT_CLUSTER, type GNode } from '@/lib/graph/build';
import { globeLayout, type V3 } from '@/lib/graph/globe';
import { assignVerticalColors, EDGE_STYLES, METRIC_LABEL, MODES, type FlowMetric, type GraphMode } from '@/lib/graph/theme';
import { investorInsights } from '@/lib/analytics/insights';
import { milestone } from '@/lib/analytics/whatif';
import { money, num, pct } from '@/lib/analytics/format';
import { periodStatus } from '@/lib/domain/provenance';
import { StatusBadge } from '@/components/ui/primitives';
import { MixBar, ScoreGauge } from '@/components/ui/charts';
import type { GlobeEdge, GlobeNode } from './GlobeScene';

const GlobeScene = dynamic(() => import('./GlobeScene').then((m) => m.GlobeScene), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[12px] text-muted">Rendering globe…</div>,
});

const lighten = (hex: string, t: number) => `#${new Color(hex).lerp(new Color('#ffffff'), t).getHexString()}`;
const safeHex = (c: string) => (c.startsWith('#') ? c : '#8fa3b8');

function radiusFor(n: GNode) {
  const s = n.data.size;
  switch (n.data.kind) {
    case 'vertical': return 0.55 + ((s - 74) / 68) * 0.6;
    case 'product': return 0.17 + ((s - 30) / 44) * 0.22;
    case 'segment': return 0.28 + ((s - 44) / 52) * 0.3;
    case 'infra': return 0.28;
    case 'function': return 0.26;
    case 'acquisition': return 0.9;
    default: return 0.5;
  }
}

function Glass({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`pointer-events-auto border border-white/10 bg-[rgba(6,10,18,0.62)] backdrop-blur-md ${className}`}>{children}</div>;
}

export function GlobeView() {
  const s = useApp();
  const a = useAnalysis();
  const [rotate, setRotate] = useState(true);
  // On a phone the panels would cover the globe; start with them hidden there.
  const [hud, setHud] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [labels, setLabels] = useState<'all' | 'major'>('all');
  const productCount = s.data?.products.length ?? 0;
  const [showProducts, setShowProducts] = useState(productCount <= 120);

  const scene = useMemo(() => {
    if (!s.data || !a) return null;
    const verticalIds = a.state.active.map((v) => v.id);
    const small = productCount <= 120;
    const expanded = new Set<string>([...(showProducts ? verticalIds : [...s.expanded]), ...(small ? [SEGMENT_CLUSTER, INFRA_CLUSTER] : [])]);
    const built = buildGraph({
      data: s.data, analysis: a, mode: s.mode, metric: s.metric, expanded, hiddenEdges: s.hiddenEdges, hiddenKinds: s.hiddenKinds,
      verticalFilter: s.verticalFilter, search: s.search, focusId: s.hoverId ?? s.selectedId, selectedId: s.selectedId, journeyId: s.journeyId,
      acquisition: null, positions: {}, scenarioActive: a.scenarioActive,
    });
    const pos = globeLayout(built.nodes, s.data);
    const colors = assignVerticalColors(a.state.verticals.map((v) => v.v));
    const nodes: GlobeNode[] = built.nodes.map((n) => {
      const base = n.data.verticalId ? colors[n.data.verticalId]?.base : undefined;
      const color = n.data.kind === 'vertical' && base ? base : n.data.kind === 'product' && base ? lighten(base, 0.3) : safeHex(n.data.color);
      return { node: n, pos: pos[n.id], color, radius: radiusFor(n) };
    });
    const edges: GlobeEdge[] = built.edges.filter((e) => pos[e.source] && pos[e.target]).map((e) => {
      const A = pos[e.source], B = pos[e.target];
      const m: V3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      let mid = m;
      if (e.source !== 'parent' && e.target !== 'parent') {
        const ml = Math.hypot(...m) || 1;
        const dist = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
        const lift = Math.max(Math.hypot(...A), Math.hypot(...B)) + dist * 0.32 + e.data.curvature * 3;
        mid = ml < 0.5 ? [m[0], m[1] + lift, m[2]] : [(m[0] / ml) * lift, (m[1] / ml) * lift, (m[2] / ml) * lift];
      }
      return { edge: e, a: A, b: B, mid, color: safeHex(e.data.color) };
    });
    return { nodes, edges, colors };
  }, [s.data, a, s.mode, s.metric, s.expanded, s.hiddenEdges, s.hiddenKinds, s.verticalFilter, s.search, s.hoverId, s.selectedId, s.journeyId, showProducts, productCount]);

  const ms = useMemo(() => (s.data && s.scenario && s.baseline ? milestone(s.data, s.scenario, s.baseline, 'ebitda', 1_000_000) : null), [s.data, s.scenario, s.baseline]);

  if (!a || !s.data || !scene) return null;
  const st = a.state;
  const ps = periodStatus(a.status);
  const insights = investorInsights(s.data, a).slice(0, 4);
  const activeScenario = s.savedScenarios.find((x) => x.id === s.activeScenarioId);
  const edgeKinds = MODES[s.mode].edges.filter((k) => k !== 'ownership');
  const vName = (id: string) => st.verticals.find((v) => v.id === id)?.v.name ?? id;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 45%, #0b1630 0%, #060a14 55%, #03050a 100%)' }}>
      <div className="absolute inset-0">
        <GlobeScene nodes={scene.nodes} edges={scene.edges} selectedId={s.selectedId} hoverId={s.hoverId} autoRotate={rotate} labels={labels} onSelect={(id) => s.select(id)} onHover={s.setHover} />
      </div>

      {/* ── HUD ───────────────────────────────────────────── */}
      {hud && <div className="pointer-events-none absolute inset-0 flex justify-between gap-4 overflow-hidden p-4 pb-24">
        <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto sm:w-[270px]">
          <Glass className="p-4">
            <div className="label !text-[#8fb4ff]">{s.year}{a.status.isProjected ? ' · projected' : ''} · {activeScenario?.name ?? (a.scenarioActive ? 'What-if' : 'Baseline')}</div>
            <div className="mt-1 text-[20px] font-semibold tracking-wide text-white" style={{ textShadow: '0 0 18px rgba(120,170,255,0.6)' }}>{s.data.parent.name}</div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {[
                ['Revenue', money(st.revenue), ps],
                ['EBITDA', money(st.ebitda), ps],
                ['Growth', pct(st.growth, { sign: true }), ps],
                ['Recurring', pct(st.recurringShare), ps],
                ['Customers', num(st.customers), ps],
                ['Est. value', money(a.valuation.ev), 'estimated'],
              ].map(([l, v, stt]) => (
                <div key={l}>
                  <div className="flex items-center gap-1.5"><span className="label !text-[9px]">{l}</span><StatusBadge status={stt as never} /></div>
                  <div className="num text-[17px] text-white">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3">
              <ScoreGauge score={a.health.score} label={a.health.grade} size={104} />
              <div className="flex-1 text-[11px] leading-snug text-fg-2">
                <div className="label mb-1 !text-[9px]">Health drags</div>
                {a.health.drags.map((c) => <div key={c.key}>▼ {c.label}</div>)}
              </div>
            </div>
          </Glass>
          <Glass className="p-4">
            <div className="label mb-2 !text-[9px]">Revenue mix</div>
            <MixBar format={money} items={st.active.map((v) => ({ id: v.id, label: v.v.name, value: v.revenue, color: scene.colors[v.id]?.base ?? '#e5c26b' }))} />
          </Glass>
          <Glass className="p-4">
            <div className="label mb-2 flex items-center gap-1.5 !text-[9px]"><Sparkles className="size-3 text-[#3dffa0]" />Top opportunities <StatusBadge status="estimated" /></div>
            {a.opportunities.slice(0, 4).map((o) => (
              <button key={o.id} onClick={() => o.nodeIds[0] && s.select(o.nodeIds[0])} className="mb-1.5 flex w-full items-start justify-between gap-2 text-left text-[11.5px] leading-snug text-fg-2 hover:text-white">
                <span>{o.name}</span><span className="num shrink-0 text-[#3dffa0]">+{money(o.revenue || o.profit)}</span>
              </button>
            ))}
          </Glass>
        </div>

        {!s.selectedId && (
          <div className="hidden w-[280px] shrink-0 flex-col gap-3 overflow-y-auto xl:flex">
            <Glass className="p-4">
              <div className="label mb-2 !text-[9px]">What the globe is telling you <StatusBadge status="estimated" /></div>
              <ul className="space-y-2">
                {insights.map((i) => (
                  <li key={i.id}>
                    <button onClick={() => i.nodeIds[0] && s.select(i.nodeIds[0])} className="flex gap-2 text-left text-[11.5px] leading-snug text-fg-2 hover:text-white">
                      {i.tone === 'warning' ? <TriangleAlert className="mt-0.5 size-3 shrink-0 text-[#ffb347]" /> : i.tone === 'positive' ? <Sparkles className="mt-0.5 size-3 shrink-0 text-[#3dffa0]" /> : <Info className="mt-0.5 size-3 shrink-0 text-muted" />}
                      {i.text}
                    </button>
                  </li>
                ))}
              </ul>
              {a.scenarioActive && (
                <div className="mt-3 border-t border-white/10 pt-3 text-[12px] text-white">
                  EBITDA reaches $1M: <span className="num text-[#ffe7b0]">{ms ?? `after ${s.data.parent.years.at(-1)}`}</span> <StatusBadge status="projected" />
                </div>
              )}
            </Glass>
            <Glass className="p-4">
              <div className="label mb-2 flex items-center gap-1.5 !text-[9px]"><TriangleAlert className="size-3 text-[#ff6b7a]" />Biggest risks</div>
              {a.bottlenecks.slice(0, 4).map((b) => (
                <button key={b.id} onClick={() => s.select(b.nodeId)} className="mb-1.5 flex w-full items-start gap-2 text-left text-[11.5px] leading-snug text-fg-2 hover:text-white">
                  <span className="mt-1 size-1.5 shrink-0 rotate-45" style={{ background: b.severity >= 0.75 ? '#ff3b4e' : '#ff8a3d' }} />{b.title}
                </button>
              ))}
            </Glass>
            <Glass className="p-4">
              <div className="label mb-2 !text-[9px]">Strongest synergies <StatusBadge status="estimated" /></div>
              {a.synergies.slice(0, 3).map((x) => (
                <div key={x.id} className="mb-1.5 flex items-center justify-between text-[11.5px] text-fg-2">
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: scene.colors[x.a]?.base }} />{vName(x.a)} ↔ <span className="size-2 rounded-full" style={{ background: scene.colors[x.b]?.base }} />{vName(x.b)}</span>
                  <span className="num text-white">{x.score}</span>
                </div>
              ))}
            </Glass>
          </div>
        )}
      </div>}

      {/* ── Controls + legend ─────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <Glass className="mx-4 flex max-w-[calc(100%-2rem)] flex-col items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap justify-center">
              {(Object.keys(MODES) as GraphMode[]).map((m) => (
                <button key={m} title={MODES[m].question} onClick={() => s.setMode(m)} className={`px-2 py-1 text-[11px] transition ${s.mode === m ? 'text-white shadow-[inset_0_-1px_0_#8fb4ff]' : 'text-muted hover:text-white'}`}>{MODES[m].label}</button>
              ))}
            </div>
            <span className="h-4 w-px bg-white/10" />
            <select value={s.metric} onChange={(e) => s.setMetric(e.target.value as FlowMetric)} className="bg-transparent text-[11px] text-white outline-none" aria-label="Flow metric">
              {(Object.keys(METRIC_LABEL) as FlowMetric[]).map((m) => <option key={m} value={m} className="bg-panel">{METRIC_LABEL[m]}</option>)}
            </select>
            <span className="h-4 w-px bg-white/10" />
            <button onClick={() => setRotate((r) => !r)} title={rotate ? 'Pause rotation' : 'Rotate'} className="text-muted hover:text-white">{rotate ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
            <button onClick={() => setLabels((l) => (l === 'all' ? 'major' : 'all'))} title="Toggle labels" className={labels === 'all' ? 'text-white' : 'text-muted hover:text-white'}><Tag className="size-3.5" /></button>
            <button onClick={() => setShowProducts((p) => !p)} title="Show products" className={showProducts ? 'text-white' : 'text-muted hover:text-white'}><Boxes className="size-3.5" /></button>
            <button onClick={() => setHud((h) => !h)} title={hud ? 'Hide panels' : 'Show panels'} className={hud ? 'text-white' : 'text-muted hover:text-white'}><PanelsTopLeft className="size-3.5" /></button>
          </div>
          <div className="hidden flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-fg-2 sm:flex">
            {st.active.map((v) => <span key={v.id} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: scene.colors[v.id]?.base, boxShadow: `0 0 6px ${scene.colors[v.id]?.base}` }} />{v.v.name}</span>)}
            <span className="h-3 w-px bg-white/10" />
            {edgeKinds.map((k) => <span key={k} className="flex items-center gap-1"><span className="h-[2px] w-3" style={{ background: EDGE_STYLES[k].color, boxShadow: `0 0 4px ${EDGE_STYLES[k].color}` }} />{EDGE_STYLES[k].label}</span>)}
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#3dffa0] shadow-[0_0_6px_#3dffa0]" />Opportunity</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full border border-[#ff3b4e]" />Risk pulse</span>
          </div>
        </Glass>
      </div>
    </div>
  );
}
