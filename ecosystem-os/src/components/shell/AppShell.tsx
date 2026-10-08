'use client';
import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useApp, VIEW_MODE } from '@/store/app';
import { TopBar } from './TopBar';
import { NavRail } from './NavRail';
import { BottomBar } from './BottomBar';
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { Legend } from '@/components/graph/Legend';
import { Inspector } from '@/components/panels/Inspector';
import { ViewPanel } from '@/components/panels/ViewPanel';
import { OverviewView } from '@/components/views/OverviewView';
import { InvestorView } from '@/components/views/InvestorView';
import { SettingsView } from '@/components/views/SettingsView';
import { GlobeView } from '@/components/globe/GlobeView';

export function AppShell() {
  const init = useApp((s) => s.init);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const data = useApp((s) => s.data);
  const view = useApp((s) => s.view);
  const selectedId = useApp((s) => s.selectedId);
  const isGraph = !!VIEW_MODE[view];

  useEffect(() => { init(); }, [init]);

  // Keyboard: Esc clears selection, "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if (e.key === 'Escape') useApp.getState().select(null);
      if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('global-search')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="grid h-screen grid-rows-[44px_1fr] bg-bg">
        <TopBar />
        <div className="grid min-h-0 grid-cols-[184px_1fr]">
          <NavRail />
          <main className="relative flex min-h-0 min-w-0 flex-col">
            {!data ? (
              <div className="grid flex-1 place-items-center text-[12px] text-muted">{error ? <span className="text-neg">{error}</span> : loading ? 'Loading company data…' : 'No data'}</div>
            ) : view === 'globe' ? (
              <div className="flex min-h-0 flex-1">
                <GlobeView />
                {selectedId && <Inspector />}
              </div>
            ) : isGraph ? (
              <>
                <div className="flex min-h-0 flex-1">
                  <ViewPanel />
                  <div className="relative min-w-0 flex-1">
                    <GraphCanvas />
                    <Legend />
                  </div>
                  {selectedId && <Inspector />}
                </div>
                <BottomBar />
              </>
            ) : view === 'overview' ? (
              <OverviewView />
            ) : view === 'investor' ? (
              <InvestorView />
            ) : (
              <SettingsView />
            )}
          </main>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
