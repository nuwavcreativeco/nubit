import type { AcquisitionInput, CompanyData } from '@/lib/domain/types';
import type { AcquisitionAnalysis } from '@/lib/analytics/acquisition';
import type { CompanyState } from '@/lib/analytics/model';

export interface Point { x: number; y: number }

const polar = (r: number, a: number): Point => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
const TAU = Math.PI * 2;

/** Weighted circular mean of angles. */
function meanAngle(items: { angle: number; weight: number }[], fallback: number) {
  let x = 0, y = 0;
  for (const i of items) { x += Math.cos(i.angle) * i.weight; y += Math.sin(i.angle) * i.weight; }
  return x === 0 && y === 0 ? fallback : Math.atan2(y, x);
}

/** Pushes angles apart until neighbours are at least `gap` radians away (keeps order). */
function spread(items: { id: string; angle: number }[], gap: number) {
  const sorted = [...items].sort((a, b) => a.angle - b.angle);
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i], b = sorted[(i + 1) % sorted.length];
      if (sorted.length < 2) break;
      let d = b.angle - a.angle;
      if (i === sorted.length - 1) d += TAU;
      if (d < gap) {
        const push = (gap - d) / 2;
        a.angle -= push; b.angle += push; moved = true;
      }
    }
    if (!moved) break;
  }
  return Object.fromEntries(sorted.map((s) => [s.id, s.angle]));
}

/**
 * Deterministic radial layout: parent at the centre, verticals on a ring, each vertical's products
 * fanned outward in arcs, shared infrastructure on an inner ring near the verticals it serves, and
 * customer segments on an outer ring near the verticals they buy from. Positions are stable across
 * modes so switching views never reshuffles the map.
 */
export function computeLayout(
  data: CompanyData,
  state: CompanyState,
  opts: { expanded: Set<string>; showSegments: boolean; showInfra: boolean; acquisition: { input: AcquisitionInput; analysis: AcquisitionAnalysis } | null },
): Record<string, Point> {
  const out: Record<string, Point> = { parent: { x: 0, y: 0 } };
  const verts = state.active;
  const n = Math.max(verts.length, 1);
  const R1 = Math.max(460, n * 82);
  const vAngle: Record<string, number> = {};
  verts.forEach((v, i) => {
    vAngle[v.id] = -Math.PI / 2 + (i / n) * TAU;
    out[v.id] = polar(R1, vAngle[v.id]);
  });

  // Products: concentric arcs inside each vertical's own angular sector, outward from the ring.
  // Sectors never overlap, so expanding every vertical (even ~100 products each) stays legible.
  let deepest = 0;
  const sector = TAU / n;
  // Px between neighbouring products on an arc: room for full labels normally, dense at scale
  // (large clusters render as shapes at the zoom level where they're all visible).
  const maxPerVertical = Math.max(0, ...verts.map((v) => data.products.filter((p) => p.vertical === v.id).length));
  const GAP = maxPerVertical > 20 ? 80 : 140;
  for (const v of verts) {
    const ps = data.products.filter((p) => p.vertical === v.id && state.products[p.id]?.active);
    let placed = 0, ring = 0;
    while (placed < ps.length) {
      const r = R1 + 175 + ring * 70;
      const cap = Math.max(2, Math.floor((r * sector * 0.84) / GAP));
      const take = Math.min(cap, ps.length - placed);
      const span = Math.min(sector * 0.84, ((take - 1) * GAP) / r);
      const offset = ring % 2 ? GAP / r / 2 : 0; // stagger alternate rings
      for (let k = 0; k < take; k++) {
        const t = take === 1 ? 0 : k / (take - 1) - 0.5;
        out[ps[placed + k].id] = polar(r, vAngle[v.id] + t * span + (take > 1 ? offset : 0));
      }
      placed += take;
      ring++;
    }
    if (opts.expanded.has(v.id)) deepest = Math.max(deepest, 175 + (ring - 1) * 70);
  }

  // Shared infrastructure + shared teams on an inner ring, near the verticals that use them.
  const RI = R1 * 0.52;
  const infraItems = [
    ...data.infra.map((i) => ({ id: i.id, angle: meanAngle(i.dependents.filter((d) => vAngle[d] !== undefined).map((d) => ({ angle: vAngle[d], weight: 1 })), Math.PI / 2) })),
    ...data.functions.map((f) => ({ id: f.id, angle: meanAngle(f.serves.filter((d) => vAngle[d] !== undefined).map((d) => ({ angle: vAngle[d], weight: 1 })), Math.PI / 2) })),
  ];
  const infraAngles = spread(infraItems, Math.min(0.55, TAU / Math.max(infraItems.length, 1)));
  for (const [id, ang] of Object.entries(infraAngles)) out[id] = polar(RI, ang);
  out['cluster:infra'] = { x: 0, y: R1 * 0.4 };

  // Segments on an outer ring, pulled toward the verticals they spend the most with.
  const RS = R1 + 330 + deepest;
  const prodVertical = Object.fromEntries(data.products.map((p) => [p.id, p.vertical]));
  const segItems = state.segments.map((s) => ({
    id: s.id,
    angle: meanAngle(s.s.purchases.filter((pu) => vAngle[prodVertical[pu.product]] !== undefined).map((pu) => ({ angle: vAngle[prodVertical[pu.product]], weight: pu.revenue })), Math.PI / 2),
  }));
  const segAngles = spread(segItems, Math.min(0.42, TAU / Math.max(segItems.length, 1)));
  for (const [id, ang] of Object.entries(segAngles)) out[id] = polar(RS, ang);
  out['cluster:segments'] = polar(R1 + 300, Math.PI / 2 + TAU / n / 2);

  if (opts.acquisition) {
    const top = opts.acquisition.analysis.connections[0];
    const base = top ? vAngle[top.vertical] ?? 0 : 0;
    out['acquisition'] = polar(R1 + 330, base + TAU / n / 2);
  }
  return out;
}
