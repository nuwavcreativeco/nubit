'use client';
import { useState } from 'react';
import { ChevronsLeft, ChevronsRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useApp } from '@/store/app';
import { MODES } from '@/lib/graph/theme';
import { EcosystemPanel, RevenuePanel, CustomersPanel } from './lenses';
import { SynergyPanel } from './SynergyPanel';
import { OpportunitiesPanel } from './OpportunitiesPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { OperationsPanel, RiskPanel } from './OpsRiskPanels';
import { AnalystPanel } from './AnalystPanel';

const TITLES: Record<string, string> = {
  graph: 'Ecosystem', revenue: 'Revenue', customers: 'Customers', synergies: 'Synergies', opportunities: 'Opportunities',
  scenarios: 'What-if scenarios', operations: 'Operations', risk: 'Risk', analyst: 'AI analyst',
};

export function ViewPanel() {
  const view = useApp((s) => s.view);
  const mode = useApp((s) => s.mode);
  const [wide, setWide] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) {
    return (
      <button onClick={() => setHidden(false)} className="flex w-8 shrink-0 flex-col items-center gap-2 border-r border-line bg-panel pt-3 text-muted hover:text-fg" title="Show panel">
        <PanelLeftOpen className="size-4" />
        <span className="label [writing-mode:vertical-rl]">{TITLES[view]}</span>
      </button>
    );
  }

  return (
    <aside className={`flex shrink-0 flex-col border-r border-line bg-panel transition-[width] ${wide ? 'w-[620px]' : view === 'analyst' ? 'w-[440px]' : 'w-[380px]'}`}>
      <div className="flex h-11 items-center justify-between gap-2 border-b border-line px-4">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-medium text-fg">{TITLES[view]}</h2>
          <p className="truncate text-[10.5px] text-muted">{MODES[mode].question}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-muted">
          <button onClick={() => setWide((w) => !w)} title={wide ? 'Narrow' : 'Widen'} className="p-1 hover:text-fg">{wide ? <ChevronsLeft className="size-3.5" /> : <ChevronsRight className="size-3.5" />}</button>
          <button onClick={() => setHidden(true)} title="Hide panel" className="p-1 hover:text-fg"><PanelLeftClose className="size-3.5" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'graph' && <EcosystemPanel />}
        {view === 'revenue' && <RevenuePanel />}
        {view === 'customers' && <CustomersPanel />}
        {view === 'synergies' && <SynergyPanel />}
        {view === 'opportunities' && <OpportunitiesPanel />}
        {view === 'scenarios' && <ScenarioPanel />}
        {view === 'operations' && <OperationsPanel />}
        {view === 'risk' && <RiskPanel />}
        {view === 'analyst' && <AnalystPanel />}
      </div>
    </aside>
  );
}
