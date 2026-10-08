import type { CompanyData } from '@/lib/domain/types';
import type { GNode } from './build';
import { INFRA_CLUSTER, SEGMENT_CLUSTER } from './build';

export type V3 = [number, number, number];

export const GLOBE_R = 10;

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Orthonormal tangent basis at a point on the sphere. */
function tangents(d: V3): [V3, V3] {
  const up: V3 = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const t1 = norm(cross(up, d));
  return [t1, norm(cross(d, t1))];
}

/** Point at angular distance `rho` from direction `d`, around it at angle `alpha`. */
function around(d: V3, rho: number, alpha: number): V3 {
  const [t1, t2] = tangents(d);
  return norm(add(scale(d, Math.cos(rho)), scale(add(scale(t1, Math.cos(alpha)), scale(t2, Math.sin(alpha))), Math.sin(rho))));
}

/**
 * 3D placement for the globe view. The parent is the core; verticals sit on the sphere surface with
 * their products clustered around them (golden-angle spiral, so any count packs evenly); shared
 * infrastructure floats inside near the verticals that use it; customer segments orbit outside, pulled
 * toward the verticals they buy from.
 */
export function globeLayout(nodes: GNode[], data: CompanyData): Record<string, V3> {
  const R = GLOBE_R;
  const out: Record<string, V3> = { parent: [0, 0, 0] };
  const verticals = nodes.filter((n) => n.data.kind === 'vertical');
  const n = Math.max(1, verticals.length);
  const vDir: Record<string, V3> = {};
  const LAT3 = [0.38, -0.2, 0.12];
  verticals.forEach((v, i) => {
    const theta = (i / n) * Math.PI * 2 + 0.35;
    const lat = n <= 3 ? LAT3[i] : i % 2 ? 0.3 : -0.14;
    vDir[v.id] = norm([Math.cos(lat) * Math.cos(theta), Math.sin(lat), Math.cos(lat) * Math.sin(theta)]);
    out[v.id] = scale(vDir[v.id], R);
  });

  const byVertical: Record<string, GNode[]> = {};
  for (const p of nodes.filter((x) => x.data.kind === 'product')) (byVertical[p.data.verticalId!] ??= []).push(p);
  for (const [vid, list] of Object.entries(byVertical)) {
    const d = vDir[vid];
    if (!d) continue;
    const k = list.length;
    const rhoMax = Math.min(Math.PI / n * 0.85, 0.2 + 0.05 * Math.sqrt(k));
    list.forEach((p, j) => {
      const rho = 0.09 + rhoMax * Math.sqrt((j + 0.5) / k);
      out[p.id] = scale(around(d, rho, j * 2.39996 + 0.6), R);
    });
  }

  const prodVertical = Object.fromEntries(data.products.map((p) => [p.id, p.vertical]));
  const segs = nodes.filter((x) => x.data.kind === 'segment');
  segs.forEach((s, i) => {
    const seg = data.segments.find((x) => x.id === s.id);
    let d: V3 = [0, -0.3, 1];
    if (seg) {
      d = seg.purchases.reduce<V3>((acc, pu) => {
        const vd = vDir[prodVertical[pu.product]];
        return vd ? add(acc, scale(vd, pu.revenue)) : acc;
      }, [0, 0, 0]);
    }
    const base = norm(Math.hypot(...d) < 1e-6 ? [0, -0.3, 1] : d);
    out[s.id] = scale(around(base, 0.18 + (i % 3) * 0.12, i * 2.1), R * 1.55);
  });

  const inner = nodes.filter((x) => x.data.kind === 'infra' || x.data.kind === 'function');
  inner.forEach((x, i) => {
    const deps = data.infra.find((q) => q.id === x.id)?.dependents ?? data.functions.find((q) => q.id === x.id)?.serves ?? [];
    const d = deps.reduce<V3>((acc, id) => (vDir[id] ? add(acc, vDir[id]) : acc), [0, 0, 0]);
    const base = norm(Math.hypot(...d) < 0.2 ? [0, -1, 0.2] : d);
    out[x.id] = scale(around(base, 0.25 + (i % 2) * 0.2, i * 2.4), R * 0.55);
  });

  out[SEGMENT_CLUSTER] = scale(norm([0.2, -0.8, 0.6]), R * 1.45);
  out[INFRA_CLUSTER] = scale(norm([0, -1, 0.15]), R * 0.5);
  const acq = nodes.find((x) => x.id === 'acquisition');
  if (acq) out.acquisition = scale(norm([0.6, 0.55, -0.6]), R * 1.5);
  for (const x of nodes) if (!out[x.id]) out[x.id] = scale(norm([Math.sin(x.id.length), 0.2, Math.cos(x.id.length)]), R * 1.2);
  return out;
}
