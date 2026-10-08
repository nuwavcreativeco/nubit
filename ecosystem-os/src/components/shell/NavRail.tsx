'use client';
import { Globe2, Bot, Briefcase, Coins, Gauge, GitFork, LayoutDashboard, Lightbulb, Network, Settings, ShieldAlert, SlidersHorizontal, Users, Server } from 'lucide-react';
import { useApp, type ViewId } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';

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
  { id: 'settings', label: 'Settings & Data', icon: Settings, group: 'System' },
];

export function NavRail() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const system = useApp((s) => s.system);
  const a = useAnalysis();
  const critical = a?.bottlenecks.filter((b) => b.severity >= 0.75).length ?? 0;

  return (
    <nav className="flex min-h-0 flex-col border-r border-line bg-panel">
      <div className="flex-1 overflow-y-auto py-2">
        {NAV.map((n) => (
          <div key={n.id}>
            {n.group && <div className="label px-4 pb-1 pt-3 !text-[9px] !text-dim">{n.group}</div>}
            <button
              onClick={() => setView(n.id)}
              className={`relative flex w-full items-center gap-2.5 px-4 py-[7px] text-left text-[12.5px] transition ${view === n.id ? 'bg-panel-3 text-fg' : 'text-fg-2 hover:bg-panel-2 hover:text-fg'}`}
            >
              {view === n.id && <span className="absolute inset-y-1 left-0 w-[2px] bg-accent" />}
              <n.icon className="size-3.5 shrink-0" strokeWidth={1.7} />
              <span className="flex-1">{n.label}</span>
              {n.id === 'risk' && critical > 0 && <span className="num text-[10px]" style={{ color: 'var(--critical)' }}>{critical}</span>}
              {n.id === 'opportunities' && a && <span className="num text-[10px] text-muted">{a.opportunities.length}</span>}
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-line px-4 py-3 text-[10px] text-muted">
        <div className="flex items-center gap-1.5"><Gauge className="size-3" /> Health <span className="num ml-auto text-fg-2">{a?.health.score ?? '—'}</span></div>
        <div className="flex items-center justify-between"><span>Storage</span><span className="num text-fg-2">{system?.storage ?? '…'}</span></div>
        <div className="flex items-center justify-between"><span>Analyst</span><span className="num text-fg-2">{system?.ai === 'claude' ? 'Claude' : 'Deterministic'}</span></div>
      </div>
    </nav>
  );
}
