'use client';
import { useMemo } from 'react';
import { analyze, type FullAnalysis } from '@/lib/analytics';
import { analyzeAcquisition } from '@/lib/analytics/acquisition';
import type { StatusContext } from '@/lib/domain/provenance';
import { useApp } from './app';

/** Memoised engine run for the current company / year / scenario. UI components read results; they never compute. */
export function useAnalysis(): (FullAnalysis & { status: StatusContext; scenarioActive: boolean }) | null {
  const data = useApp((s) => s.data);
  const year = useApp((s) => s.year);
  const scenario = useApp((s) => s.scenario);
  const baseline = useApp((s) => s.baseline);
  return useMemo(() => {
    if (!data || !scenario || !baseline) return null;
    const scenarioActive = JSON.stringify(scenario) !== JSON.stringify(baseline);
    const a = analyze(data, year, scenario, baseline);
    return { ...a, scenarioActive, status: { isProjected: year > data.parent.currentYear, scenarioActive: scenarioActive && year >= data.parent.currentYear } };
  }, [data, year, scenario, baseline]);
}

/** Baseline analysis for the current year — used for "vs. baseline" deltas. */
export function useBaselineAnalysis() {
  const data = useApp((s) => s.data);
  const baseline = useApp((s) => s.baseline);
  const year = useApp((s) => s.year);
  return useMemo(() => (data && baseline ? analyze(data, year, baseline, baseline) : null), [data, baseline, year]);
}

export function useAcquisitionOverlay() {
  const data = useApp((s) => s.data);
  const draft = useApp((s) => s.acquisitionDraft);
  const a = useAnalysis();
  return useMemo(() => (data && draft && a ? { input: draft, analysis: analyzeAcquisition(data, a.state, draft) } : null), [data, draft, a]);
}
