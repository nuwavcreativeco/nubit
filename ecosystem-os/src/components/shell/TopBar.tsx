'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FileImage, FileSpreadsheet, FileText, Search, Braces } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useApp, VIEW_MODE } from '@/store/app';
import { useAnalysis, useBaselineAnalysis } from '@/store/useAnalysis';
import { money, pct } from '@/lib/analytics/format';
import { StatusBadge } from '@/components/ui/primitives';
import { download, entitiesCsv, opportunitiesCsv, projectionsCsv } from '@/lib/export/csv';
import type { DataStatus } from '@/lib/domain/types';

function Kpi({ label, value, status, delta }: { label: string; value: string; status: DataStatus; delta?: number | null }) {
  return (
    <div className="flex shrink-0 flex-col justify-center border-l border-line px-3">
      <div className="flex items-center gap-1.5"><span className="label !text-[9px]">{label}</span><StatusBadge status={status} /></div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[13px] text-fg">{value}</span>
        {delta !== undefined && delta !== null && Math.abs(delta) > 0.0005 && <span className="num text-[10px]" style={{ color: delta > 0 ? 'var(--pos)' : 'var(--neg)' }}>{pct(delta, { sign: true, digits: 1 })}</span>}
      </div>
    </div>
  );
}

function Menu({ label, children, align = 'left' }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-8 items-center gap-1.5 px-2.5 text-[12px] text-fg-2 hover:bg-panel-3 hover:text-fg">{label}<ChevronDown className="size-3 text-muted" /></button>
      {open && <div className={`fade-in absolute top-full z-50 mt-1 min-w-56 border border-line-2 bg-panel-3 py-1 shadow-2xl shadow-black/60 ${align === 'right' ? 'right-0' : 'left-0'}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

const Item = ({ children, onClick, active, hint }: { children: React.ReactNode; onClick: () => void; active?: boolean; hint?: string }) => (
  <button onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-panel-2 ${active ? 'text-fg' : 'text-fg-2'}`}>
    <span className="flex flex-1 items-center gap-2">{children}</span>
    {hint && <span className="text-[10px] text-muted">{hint}</span>}
  </button>
);

function SearchBox() {
  const data = useApp((s) => s.data);
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  const select = useApp((s) => s.select);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const [focused, setFocused] = useState(false);
  const [idx, setIdx] = useState(0);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!data || !q) return [];
    const all = [
      ...data.verticals.map((v) => ({ id: v.id, name: v.name, kind: 'Vertical' })),
      ...data.products.map((p) => ({ id: p.id, name: p.name, kind: `Product · ${data.verticals.find((v) => v.id === p.vertical)?.name ?? ''}` })),
      ...data.segments.map((s) => ({ id: s.id, name: s.name, kind: 'Segment' })),
      ...data.infra.map((i) => ({ id: i.id, name: i.name, kind: 'Infrastructure' })),
      ...data.functions.map((f) => ({ id: f.id, name: f.name, kind: 'Shared team' })),
    ];
    return all.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 12);
  }, [data, search]);
  const go = (id: string) => {
    if (!VIEW_MODE[view]) setView('graph');
    select(id, { focus: true });
    setFocused(false);
  };
  return (
    <div className="relative">
      <div className="flex h-8 w-52 items-center gap-2 border border-line bg-bg px-2.5 focus-within:border-line-2">
        <Search className="size-3.5 text-muted" />
        <input
          id="global-search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setIdx(0); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, results.length - 1));
            if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
            if (e.key === 'Enter' && results[idx]) go(results[idx].id);
            if (e.key === 'Escape') { setSearch(''); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder="Search nodes…"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-dim"
        />
        <kbd className="num text-[10px] text-dim">/</kbd>
      </div>
      {focused && results.length > 0 && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 border border-line-2 bg-panel-3 py-1 shadow-2xl shadow-black/60">
          {results.map((r, i) => (
            <button key={r.id} onMouseDown={() => go(r.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] ${i === idx ? 'bg-panel-2 text-fg' : 'text-fg-2'}`}>
              <span className="truncate">{r.name}</span><span className="shrink-0 text-[10px] text-muted">{r.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const s = useApp();
  const a = useAnalysis();
  const base = useBaselineAnalysis();
  if (!s.data || !a || !s.scenario || !s.baseline) {
    return <header className="flex items-center border-b border-line bg-panel px-4"><Logo /></header>;
  }
  const cur = s.data.parent.currentYear;
  const st: DataStatus = a.status.isProjected || a.status.scenarioActive ? 'projected' : 'actual';
  const delta = (x: number, y?: number) => (a.scenarioActive && y ? x / y - 1 : null);
  const activeScenario = s.savedScenarios.find((x) => x.id === s.activeScenarioId);

  const exportImage = async () => {
    const el = document.querySelector('.react-flow') as HTMLElement | null;
    if (!el) return alert('Open a graph view to export the graph image.');
    const url = await toPng(el, { backgroundColor: '#07090c', pixelRatio: 2, filter: (n) => !(n as HTMLElement).classList?.contains('react-flow__minimap') && !(n as HTMLElement).classList?.contains('react-flow__controls') });
    const link = document.createElement('a');
    link.href = url;
    link.download = `${s.data!.meta.id}-${s.mode}-${s.year}.png`;
    link.click();
  };

  return (
    <header className="flex min-w-0 items-stretch border-b border-line bg-panel">
      <div className="flex w-[184px] shrink-0 items-center border-r border-line px-4"><Logo /></div>

      <div className="flex items-center gap-1 border-r border-line px-2">
        <Menu label={<span className="max-w-44 truncate text-fg">{s.data.parent.name}</span>}>
          {(close) => s.companies.map((c) => (
            <Item key={c.id} active={c.id === s.companyId} hint={c.source} onClick={() => { close(); s.loadCompany(c.id); }}>{c.name}</Item>
          ))}
        </Menu>
      </div>

      {/* Timeline */}
      <div className="flex items-center gap-0 border-r border-line px-2" role="group" aria-label="Year">
        {s.data.parent.years.map((y) => (
          <button key={y} onClick={() => s.setYear(y)} className={`relative flex h-8 flex-col items-center justify-center px-2.5 ${s.year === y ? 'text-fg' : 'text-muted hover:text-fg-2'}`}>
            <span className="num text-[12px]">{y}</span>
            <span className="text-[8px] uppercase tracking-wider" style={{ color: y > cur ? 'var(--st-projected)' : y === cur ? 'var(--accent)' : 'var(--dim)' }}>{y > cur ? 'proj' : y === cur ? 'now' : 'act'}</span>
            {s.year === y && <span className="absolute inset-x-1 bottom-0 h-[2px] bg-accent" />}
          </button>
        ))}
      </div>

      <div className="flex items-center border-r border-line px-1">
        <Menu label={<span className="flex items-center gap-1.5"><span className="label !text-[9px]">Scenario</span><span className={a.scenarioActive ? 'text-accent' : 'text-fg'}>{activeScenario?.name ?? (a.scenarioActive ? 'Unsaved what-if' : 'Baseline')}</span></span>}>
          {(close) => (
            <>
              <Item active={!a.scenarioActive} onClick={() => { close(); s.applySavedScenario(null); }}>Baseline</Item>
              {s.savedScenarios.map((sc) => <Item key={sc.id} active={sc.id === s.activeScenarioId} hint={new Date(sc.createdAt).toLocaleDateString()} onClick={() => { close(); s.applySavedScenario(sc); }}>{sc.name}</Item>)}
              <div className="my-1 border-t border-line" />
              <Item onClick={() => { close(); s.setView('scenarios'); }}>Open scenario simulator…</Item>
            </>
          )}
        </Menu>
      </div>

      <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
        <Kpi label={`Revenue ${s.year}`} value={money(a.state.revenue)} status={st} delta={delta(a.state.revenue, base?.state.revenue)} />
        <div className="hidden 2xl:flex"><Kpi label="Growth" value={pct(a.state.growth, { sign: true, digits: 1 })} status={st} /></div>
        <Kpi label="EBITDA" value={money(a.state.ebitda)} status={st} delta={delta(a.state.ebitda, base?.state.ebitda)} />
        <div className="hidden xl:flex"><Kpi label="Health" value={`${a.health.score}/100`} status="estimated" /></div>
        <Kpi label="Est. EV" value={money(a.valuation.ev)} status="estimated" delta={delta(a.valuation.ev, base?.valuation.ev)} />
      </div>

      <div className="flex items-center gap-1 border-l border-line px-2">
        <SearchBox />
        <Menu align="right" label={<span className="flex items-center gap-1.5"><Download className="size-3.5" />Export</span>}>
          {(close) => (
            <>
              <Item onClick={() => { close(); window.open(`/report/investor?company=${s.companyId}&year=${s.year}&scenario=${encodeURIComponent(JSON.stringify(s.scenario))}`, '_blank'); }}><FileText className="size-3.5" />Investor report (PDF)</Item>
              <Item onClick={() => { close(); window.open(`/report/executive?company=${s.companyId}&year=${s.year}&scenario=${encodeURIComponent(JSON.stringify(s.scenario))}`, '_blank'); }}><FileText className="size-3.5" />Executive / board report (PDF)</Item>
              <Item onClick={() => { close(); exportImage(); }}><FileImage className="size-3.5" />Graph image (PNG)</Item>
              <div className="my-1 border-t border-line" />
              <Item onClick={() => { close(); download(`${s.companyId}-${s.year}-entities.csv`, entitiesCsv(s.data!, s.year, s.scenario!, s.baseline!)); }}><FileSpreadsheet className="size-3.5" />Entities snapshot (CSV)</Item>
              <Item onClick={() => { close(); download(`${s.companyId}-projections.csv`, projectionsCsv(s.data!, s.scenario!, s.baseline!)); }}><FileSpreadsheet className="size-3.5" />Financial projections (CSV)</Item>
              <Item onClick={() => { close(); download(`${s.companyId}-opportunities.csv`, opportunitiesCsv(s.data!, s.year, s.scenario!, s.baseline!)); }}><FileSpreadsheet className="size-3.5" />Opportunities (CSV)</Item>
              <Item onClick={() => { close(); download(`${s.companyId}.json`, JSON.stringify(s.data, null, 2), 'application/json'); }}><Braces className="size-3.5" />Company data (JSON)</Item>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r="2.6" fill="var(--accent)" />
        <circle cx="9" cy="9" r="7.5" fill="none" stroke="var(--line-2)" />
        {[0, 72, 144, 216, 288].map((d) => <circle key={d} cx={9 + 7.5 * Math.cos((d - 90) * Math.PI / 180)} cy={9 + 7.5 * Math.sin((d - 90) * Math.PI / 180)} r="1.4" fill="var(--fg-2)" />)}
      </svg>
      <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-fg">ECOSYSTEM<span className="text-accent">OS</span></span>
    </div>
  );
}
