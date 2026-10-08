'use client';
import { Expand, Shrink, LocateFixed, RotateCcw, Layers } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { METRIC_LABEL, MODES, type FlowMetric, type GraphMode } from '@/lib/graph/theme';
import { Btn, Segmented } from '@/components/ui/primitives';

export function BottomBar() {
  const s = useApp();
  const a = useAnalysis();
  const activeVerticals = a?.state.active.map((v) => v.id) ?? [];
  const allExpanded = activeVerticals.every((id) => s.expanded.has(id));
  const productCount = s.data?.products.length ?? 0;

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 overflow-x-auto border-t border-line bg-panel px-3">
      <span className="label shrink-0">Mode</span>
      <Segmented<GraphMode>
        size="xs"
        value={s.mode}
        onChange={s.setMode}
        options={(Object.keys(MODES) as GraphMode[]).map((m) => ({ value: m, label: MODES[m].label, title: MODES[m].question }))}
      />
      <span className="label ml-2 shrink-0">Flow metric</span>
      <select
        value={s.metric}
        onChange={(e) => s.setMetric(e.target.value as FlowMetric)}
        className="h-7 shrink-0 border border-line bg-panel-2 px-2 text-[12px] text-fg outline-none"
        aria-label="Flow metric"
      >
        {(Object.keys(METRIC_LABEL) as FlowMetric[]).map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
      </select>
      <span className="hidden shrink-0 text-[11px] text-muted xl:inline">{MODES[s.mode].question}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Btn
          title={allExpanded ? 'Collapse to verticals' : 'Expand every vertical'}
          onClick={() => s.setExpanded(allExpanded ? [] : activeVerticals)}
        >
          {allExpanded ? <Shrink className="size-3.5" /> : <Expand className="size-3.5" />}
          {allExpanded ? 'Collapse all' : productCount > 300 ? `Expand all (${productCount})` : 'Expand all'}
        </Btn>
        <Btn title="Fit graph to screen" onClick={() => s.requestFit(null)}><LocateFixed className="size-3.5" />Fit</Btn>
        <Btn title="Reset dragged node positions" onClick={s.resetLayout}><RotateCcw className="size-3.5" />Layout</Btn>
        <Btn title="Toggle legend" onClick={s.toggleLegend}><Layers className="size-3.5" />Legend</Btn>
      </div>
    </div>
  );
}
