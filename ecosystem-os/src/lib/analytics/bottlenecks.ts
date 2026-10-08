import type { CompanyData } from '@/lib/domain/types';
import type { CompanyState } from './model';
import { clamp, money, pct } from './format';

export type BottleneckType = 'sales' | 'operations' | 'technology' | 'customer' | 'financial' | 'personnel';

export interface Bottleneck {
  id: string;
  nodeId: string;
  type: BottleneckType;
  severity: number; // 0-1
  title: string;
  detail: string;
  fix: string;
}

export const BOTTLENECK_LABEL: Record<BottleneckType, string> = {
  sales: 'Sales',
  operations: 'Operations',
  technology: 'Technology',
  customer: 'Customer',
  financial: 'Financial',
  personnel: 'Personnel',
};

/** Rule-based detection. Each rule converts how far a metric is past its threshold into a severity. */
export function detectBottlenecks(data: CompanyData, state: CompanyState): Bottleneck[] {
  const out: Bottleneck[] = [];
  const active = new Set(state.active.map((v) => v.id));

  for (const vs of state.active) {
    if (vs.isNew) continue;
    const { v } = vs;
    const o = v.ops;

    if (o.leadsNeeded > 0 && o.leadsPerMonth < o.leadsNeeded) {
      const gap = 1 - o.leadsPerMonth / o.leadsNeeded;
      out.push({
        id: `sales-${v.id}`, nodeId: v.id, type: 'sales', severity: clamp(gap * 2.5),
        title: `${v.name}: insufficient lead flow`,
        detail: `${o.leadsPerMonth.toLocaleString()} leads/mo against ${o.leadsNeeded.toLocaleString()} needed to hit plan (${pct(gap)} short).`,
        fix: 'Route sister-vertical audiences and referrals into this pipeline; add a dedicated demand-gen budget.',
      });
    }
    if (o.utilization > 0.85) {
      out.push({
        id: `ops-${v.id}`, nodeId: v.id, type: 'operations', severity: clamp((o.utilization - 0.85) / 0.12),
        title: `${v.name}: delivery capacity at ${pct(o.utilization)}`,
        detail: 'Teams above ~85% utilization stop taking on new work well; growth stalls or quality slips.',
        fix: 'Hire ahead of demand, productize repeatable work, or shift delivery to automation.',
      });
    }
    if (o.keyPersonRisk >= 0.5) {
      out.push({
        id: `people-${v.id}`, nodeId: v.id, type: 'personnel', severity: clamp((o.keyPersonRisk - 0.4) / 0.5),
        title: `${v.name}: key-person dependency`,
        detail: `Revenue or delivery depends heavily on one or two people (risk ${pct(o.keyPersonRisk)}).`,
        fix: 'Document playbooks, build a second-in-command, and tie key people to retention incentives.',
      });
    }
    if (o.topCustomerShare >= 0.15) {
      out.push({
        id: `cust-${v.id}`, nodeId: v.id, type: 'customer', severity: clamp((o.topCustomerShare - 0.1) / 0.25),
        title: `${v.name}: top customer is ${pct(o.topCustomerShare)} of revenue`,
        detail: 'Losing that one account would materially dent this vertical.',
        fix: 'Diversify with cross-sold accounts from sister verticals; lock in multi-year terms.',
      });
    }
  }

  for (const i of data.infra) {
    const deps = i.dependents.filter((d) => active.has(d));
    if (i.techDebt >= 0.5 && deps.length) {
      out.push({
        id: `tech-${i.id}`, nodeId: i.id, type: 'technology',
        severity: clamp(i.techDebt * (0.4 + deps.length / 6)),
        title: `${i.name}: outdated infrastructure`,
        detail: `Tech debt ${pct(i.techDebt)} with ${deps.length} vertical${deps.length > 1 ? 's' : ''} depending on it.`,
        fix: 'Prioritize a re-platform; every dependent vertical inherits its outages and limits.',
      });
    }
  }

  for (const f of data.functions) {
    if (f.utilization > 0.85) {
      out.push({
        id: `fn-${f.id}`, nodeId: f.id, type: 'operations', severity: clamp((f.utilization - 0.85) / 0.12),
        title: `${f.name}: shared team over-stretched`,
        detail: `${pct(f.utilization)} utilized while serving ${f.serves.length} verticals.`,
        fix: 'Add headcount or define a priority queue between verticals.',
      });
    }
    if (f.keyPersonRisk >= 0.6) {
      out.push({
        id: `fnp-${f.id}`, nodeId: f.id, type: 'personnel', severity: clamp((f.keyPersonRisk - 0.4) / 0.5),
        title: `${f.name}: single point of knowledge`,
        detail: 'Critical processes live with one person.',
        fix: 'Cross-train and document; consider an outsourced backup.',
      });
    }
  }

  const topSeg = [...state.segments].sort((a, b) => b.share - a.share)[0];
  if (topSeg && topSeg.share > 0.3) {
    out.push({
      id: `seg-${topSeg.id}`, nodeId: topSeg.id, type: 'customer', severity: clamp((topSeg.share - 0.25) / 0.3),
      title: `Concentration: ${topSeg.s.name} drive ${pct(topSeg.share)} of revenue`,
      detail: 'A downturn in this one customer segment would hit several verticals at once.',
      fix: 'Grow other segments through cross-sell and new verticals.',
    });
  }

  const p = data.parent;
  if (p.workingCapitalMonths < 3) {
    out.push({
      id: 'fin-parent', nodeId: 'parent', type: 'financial', severity: clamp((3 - p.workingCapitalMonths) / 2.5),
      title: `Working capital covers ${p.workingCapitalMonths.toFixed(1)} months`,
      detail: `Cash ${money(p.cash)} against ${money(p.monthlyOpex)}/mo opex and ${money(p.debt)} debt limits how fast growth bets can be funded.`,
      fix: 'Open a revolving credit line, tighten receivables, or reduce inventory days.',
    });
  }

  return out.sort((a, b) => b.severity - a.severity);
}

export function bottlenecksByNode(list: Bottleneck[]) {
  const map: Record<string, Bottleneck[]> = {};
  for (const b of list) (map[b.nodeId] ??= []).push(b);
  return map;
}

/** 0-100: probability-style union of the severities attached to a node. */
export function riskScore(list: Bottleneck[]) {
  return Math.round(100 * (1 - list.reduce((acc, b) => acc * (1 - b.severity), 1)));
}
