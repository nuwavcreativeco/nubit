'use client';
import { create } from 'zustand';
import type { AcquisitionInput, CompanyData, CompanyMeta, NodeKind, SavedScenario, ScenarioParams } from '@/lib/domain/types';
import { api } from '@/lib/data/client';
import { baselineScenario } from '@/lib/analytics/model';
import { MODES, type EdgeKind, type FlowMetric, type GraphMode } from '@/lib/graph/theme';
import type { Point } from '@/lib/graph/layout';

export type ViewId = 'globe' | 'overview' | 'graph' | 'revenue' | 'customers' | 'synergies' | 'opportunities' | 'scenarios' | 'operations' | 'risk' | 'investor' | 'analyst' | 'settings';

/** Graph views and the mode each one opens in. Non-graph views are full-page dashboards. */
export const VIEW_MODE: Partial<Record<ViewId, GraphMode>> = {
  globe: 'ecosystem', graph: 'ecosystem', revenue: 'revenue', customers: 'customer', synergies: 'synergy', opportunities: 'growth',
  scenarios: 'ecosystem', operations: 'operations', risk: 'risk', analyst: 'ecosystem',
};

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: { name: string; input: unknown; ok?: boolean }[];
  pending?: boolean;
  engine?: 'claude' | 'local';
  error?: string;
}

interface AppState {
  system: { storage: string; ai: 'claude' | 'local'; auth: string } | null;
  companies: CompanyMeta[];
  companyId: string | null;
  data: CompanyData | null;
  baseline: ScenarioParams | null;
  loading: boolean;
  error: string | null;

  view: ViewId;
  mode: GraphMode;
  metric: FlowMetric;
  year: number;
  scenario: ScenarioParams | null;
  activeScenarioId: string | null;
  savedScenarios: SavedScenario[];

  expanded: Set<string>;
  hiddenEdges: Set<EdgeKind>;
  hiddenKinds: Set<NodeKind>;
  verticalFilter: Set<string>;
  search: string;
  selectedId: string | null;
  hoverId: string | null;
  journeyId: string | null;
  positions: Record<string, Point>;
  fitRequest: { ids: string[] | null; at: number };
  showLegend: boolean;

  acquisitions: AcquisitionInput[];
  acquisitionDraft: AcquisitionInput | null;
  chat: ChatMessage[];
  pendingQuestion: string | null;

  init: () => Promise<void>;
  loadCompany: (id: string) => Promise<void>;
  replaceCompany: (data: CompanyData) => void;
  setView: (v: ViewId) => void;
  setMode: (m: GraphMode) => void;
  setMetric: (m: FlowMetric) => void;
  setYear: (y: number) => void;
  setScenario: (patch: Partial<ScenarioParams>) => void;
  setVerticalPlan: (id: string, plan: { extraGrowth: number; startYear: number } | null) => void;
  resetScenario: () => void;
  applySavedScenario: (s: SavedScenario | null) => void;
  saveScenario: (name: string) => Promise<void>;
  deleteScenario: (id: string) => Promise<void>;
  toggleExpanded: (id: string) => void;
  setExpanded: (ids: string[]) => void;
  toggleEdge: (k: EdgeKind) => void;
  toggleKind: (k: NodeKind) => void;
  toggleVerticalFilter: (id: string) => void;
  clearFilters: () => void;
  setSearch: (q: string) => void;
  select: (id: string | null, opts?: { focus?: boolean }) => void;
  setHover: (id: string | null) => void;
  setJourney: (id: string | null) => void;
  setPosition: (id: string, p: Point) => void;
  resetLayout: () => void;
  requestFit: (ids?: string[] | null) => void;
  toggleLegend: () => void;
  setAcquisitionDraft: (a: AcquisitionInput | null) => void;
  saveAcquisition: (a: AcquisitionInput) => Promise<void>;
  deleteAcquisition: (id: string) => Promise<void>;
  setChat: (fn: (c: ChatMessage[]) => ChatMessage[]) => void;
  askAnalyst: (q: string | null) => void;
}

const toggle = <T,>(set: Set<T>, v: T) => {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
};

export const useApp = create<AppState>((set, get) => ({
  system: null,
  companies: [],
  companyId: null,
  data: null,
  baseline: null,
  loading: true,
  error: null,

  view: 'globe',
  mode: 'ecosystem',
  metric: 'revenue',
  year: 2026,
  scenario: null,
  activeScenarioId: null,
  savedScenarios: [],

  expanded: new Set(),
  hiddenEdges: new Set(),
  hiddenKinds: new Set(),
  verticalFilter: new Set(),
  search: '',
  selectedId: null,
  hoverId: null,
  journeyId: null,
  positions: {},
  fitRequest: { ids: null, at: 0 },
  showLegend: false,

  acquisitions: [],
  acquisitionDraft: null,
  chat: [],
  pendingQuestion: null,

  init: async () => {
    try {
      const [system, companies] = await Promise.all([api.system(), api.companies()]);
      set({ system, companies });
      const saved = typeof window !== 'undefined' ? safeGet('eos.company') : null;
      const first = companies.find((c) => c.id === saved)?.id ?? companies[0]?.id;
      if (first) await get().loadCompany(first);
      else set({ loading: false, error: 'No companies available.' });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  loadCompany: async (id) => {
    set({ loading: true, error: null });
    try {
      const [data, savedScenarios, acquisitions] = await Promise.all([api.company(id), api.scenarios(id), api.acquisitions(id)]);
      safeSet('eos.company', id);
      get().replaceCompany(data);
      set({ companyId: id, savedScenarios, acquisitions, loading: false, chat: [], acquisitionDraft: null });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load company' });
    }
  },

  replaceCompany: (data) => {
    const baseline = baselineScenario(data);
    set({
      data, baseline, scenario: baseline, activeScenarioId: null, year: data.parent.currentYear,
      expanded: new Set(), verticalFilter: new Set(), selectedId: null, hoverId: null, journeyId: null, positions: {}, search: '',
      fitRequest: { ids: null, at: Date.now() },
    });
  },

  setView: (view) => {
    const mode = VIEW_MODE[view];
    set({ view, ...(mode ? { mode, metric: MODES[mode].metric } : {}), journeyId: view === 'revenue' ? get().journeyId : null });
  },
  setMode: (mode) => set({ mode, metric: MODES[mode].metric }),
  setMetric: (metric) => set({ metric }),
  setYear: (year) => set({ year }),
  setScenario: (patch) => set((s) => ({ scenario: { ...(s.scenario ?? s.baseline!), ...patch }, activeScenarioId: null })),
  setVerticalPlan: (id, plan) => set((s) => {
    const cur = s.scenario ?? s.baseline!;
    const plans = { ...(cur.verticalPlans ?? {}) };
    if (plan && plan.extraGrowth !== 0) plans[id] = plan;
    else delete plans[id];
    return { scenario: { ...cur, verticalPlans: plans }, activeScenarioId: null };
  }),
  resetScenario: () => set((s) => ({ scenario: s.baseline, activeScenarioId: null })),
  applySavedScenario: (sc) => set((s) => ({ scenario: sc ? sc.params : s.baseline, activeScenarioId: sc?.id ?? null })),
  saveScenario: async (name) => {
    const { companyId, scenario } = get();
    if (!companyId || !scenario) return;
    const saved = await api.saveScenario(companyId, name, scenario);
    set((s) => ({ savedScenarios: [saved, ...s.savedScenarios], activeScenarioId: saved.id }));
  },
  deleteScenario: async (id) => {
    await api.deleteScenario(id);
    set((s) => ({ savedScenarios: s.savedScenarios.filter((x) => x.id !== id), activeScenarioId: s.activeScenarioId === id ? null : s.activeScenarioId }));
  },

  toggleExpanded: (id) => set((s) => ({ expanded: toggle(s.expanded, id) })),
  setExpanded: (ids) => set({ expanded: new Set(ids) }),
  toggleEdge: (k) => set((s) => ({ hiddenEdges: toggle(s.hiddenEdges, k) })),
  toggleKind: (k) => set((s) => ({ hiddenKinds: toggle(s.hiddenKinds, k) })),
  toggleVerticalFilter: (id) => set((s) => ({ verticalFilter: toggle(s.verticalFilter, id) })),
  clearFilters: () => set({ hiddenEdges: new Set(), hiddenKinds: new Set(), verticalFilter: new Set(), search: '' }),
  setSearch: (search) => set({ search }),
  select: (id, opts) => {
    const { data, expanded } = get();
    // Selecting a product inside a collapsed vertical expands that vertical first.
    const product = data?.products.find((p) => p.id === id);
    const isSeg = data?.segments.some((s) => s.id === id);
    const isInfra = data?.infra.some((i) => i.id === id) || data?.functions.some((f) => f.id === id);
    const next = new Set(expanded);
    if (product) next.add(product.vertical);
    if (isSeg) next.add('cluster:segments');
    if (isInfra) next.add('cluster:infra');
    set({ selectedId: id, expanded: next, ...(opts?.focus && id ? { fitRequest: { ids: [id], at: Date.now() } } : {}) });
  },
  setHover: (hoverId) => set({ hoverId }),
  setJourney: (journeyId) => set({ journeyId }),
  setPosition: (id, p) => set((s) => ({ positions: { ...s.positions, [id]: p } })),
  resetLayout: () => set({ positions: {}, fitRequest: { ids: null, at: Date.now() } }),
  requestFit: (ids = null) => set({ fitRequest: { ids, at: Date.now() } }),
  toggleLegend: () => set((s) => ({ showLegend: !s.showLegend })),

  setAcquisitionDraft: (acquisitionDraft) => set({ acquisitionDraft }),
  saveAcquisition: async (a) => {
    const { companyId } = get();
    if (!companyId) return;
    const saved = await api.saveAcquisition(companyId, a);
    set((s) => ({ acquisitions: [saved, ...s.acquisitions], acquisitionDraft: saved }));
  },
  deleteAcquisition: async (id) => {
    await api.deleteAcquisition(id);
    set((s) => ({ acquisitions: s.acquisitions.filter((a) => a.id !== id), acquisitionDraft: s.acquisitionDraft?.id === id ? null : s.acquisitionDraft }));
  },
  setChat: (fn) => set((s) => ({ chat: fn(s.chat) })),
  askAnalyst: (pendingQuestion) => set(pendingQuestion ? { pendingQuestion, view: 'analyst', mode: 'ecosystem' } : { pendingQuestion: null }),
}));

function safeGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}
