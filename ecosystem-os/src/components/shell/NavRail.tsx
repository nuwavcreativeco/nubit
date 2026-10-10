'use client';
import { Globe2, Bot, ClipboardPen, Briefcase, Coins, Gauge, GitFork, LayoutDashboard, Lightbulb, Network, Settings, ShieldAlert, SlidersHorizontal, Users, Server } from 'lucide-react';
import { useApp, type ViewId } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { useMemo } from 'react';
import { inputFields } from '@/lib/domain/inputs';

const NAV: { id: ViewId; label: string; icon: typeof Network; group?: string }[] = [
  { id: 'globe', label: 'Globe', icon: Globe2, group: 'Command' },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'revenue', label: 'Revenue', icon: Coins, group: 'Lenses' },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'synergies', label: 'Synergies', icon: GitFork },
  { id: 'opportunities', label: 'Opportunities', icon: Lightbulb },
  { id: 'scenarios', label: 'Scenarios', icon: SlidersHorizontal },
  { id: 'operations', label: 'Operations', icon: Server },
  { id: 'risk', label: 'Risk', icon: ShieldAlert },
  { id: 'investor', label: 'Investor View', icon: Briefcase, group: 'Reporting' },
  { id: 'analyst', label: 'AI Analyst', icon: Bot },
  { id: 'inputs', label: 'Your numbers', icon: ClipboardPen, group: 'System' },
  { id: 'settings', label: 'Settings & Data', icon: Settings },
];

export function NavRail() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const system = useApp((s) => s.system);
  const a = useAnalysis();
  const critical = a?.bottlenecks.filter((b) => b.severity >= 0.75).length ?? 0;
  const data = useApp((s) => s.data);
  const estimates = useMemo(() => (data ? inputFields(data).filter((f) => f.status !== 'actual').length : 0), [data]);

  return (
    <nav className="flex min-h-0 shrink-0 flex-col border-b border-line bg-panel md:border-b-0 md:border-r">
      <div className="flex overflow-x-auto [scrollbar-width:none] md:block md:flex-1 md:overflow-y-auto md:py-2 [&::-webkit-scrollbar]:hidden">
        {NAV.map((n) => (
          <div key={n.id} className="shrink-0">
            {n.group && <div className="label hidden px-4 pb-1 pt-3 !text-[9px] !text-dim md:block">{n.group}</div>}
            <button
              onClick={() => setView(n.id)}
              className={`relative flex w-full items-center gap-2 whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] transition md:gap-2.5 md:px-4 md:py-[7px] ${view === n.id ? 'bg-panel-3 text-fg' : 'text-fg-2 hover:bg-panel-2 hover:text-fg'}`}
            >
              {view === n.id && <span className="absolute inset-x-1 bottom-0 h-[2px] bg-accent md:inset-x-auto md:inset-y-1 md:bottom-auto md:left-0 md:h-auto md:w-[2px]" />}
              <n.icon className="size-3.5 shrink-0" strokeWidth={1.7} />
              <span className="flex-1">{n.label}</span>
              {n.id === 'risk' && critical > 0 && <span className="num text-[10px]" style={{ color: 'var(--critical)' }}>{critical}</span>}
              {n.id === 'opportunities' && a && <span className="num text-[10px] text-muted">{a.opportunities.length}</span>}
              {n.id === 'inputs' && estimates > 0 && <span className="num text-[10px]" style={{ color: 'var(--st-estimated)' }} title={`${estimates} figures are still estimates`}>{estimates}</span>}
            </button>
          </div>
        ))}
      </div>
      <div className="hidden space-y-1 border-t border-line px-4 py-3 text-[10px] text-muted md:block">
        <div className="flex items-center gap-1.5"><Gauge className="size-3" /> Health <span className="num ml-auto text-fg-2">{a?.health.score ?? '—'}</span></div>
        <div className="flex items-center justify-between"><span>Storage</span><span className="num text-fg-2">{system?.storage ?? '…'}</span></div>
        <div className="flex items-center justify-between"><span>Analyst</span><span className="num text-fg-2">{system?.ai === 'claude' ? 'Claude' : 'Deterministic'}</span></div>
      </div>
    </nav>
  );
}
