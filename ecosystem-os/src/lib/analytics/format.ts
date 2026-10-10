export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
export const maxBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce<T | undefined>((best, x) => (best === undefined || f(x) > f(best) ? x : best), undefined);
export const minBy = <T,>(xs: T[], f: (x: T) => number) => maxBy(xs, (x) => -f(x));

export function money(v: number, opts: { sign?: boolean; digits?: number } = {}) {
  const sign = opts.sign && v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  const d = opts.digits;
  let s: string;
  if (a >= 1e9) s = `$${(a / 1e9).toFixed(d ?? 1)}B`;
  else if (a >= 1e6) s = `$${(a / 1e6).toFixed(d ?? (a >= 1e7 ? 1 : 2))}M`;
  else if (a >= 1e3) s = `$${(a / 1e3).toFixed(d ?? 0)}K`;
  else s = `$${a.toFixed(0)}`;
  return sign + s;
}

export function pct(v: number, opts: { sign?: boolean; digits?: number } = {}) {
  const s = `${(Math.abs(v) * 100).toFixed(opts.digits ?? 0)}%`;
  if (v < 0) return `−${s}`;
  return opts.sign && v > 0 ? `+${s}` : s;
}

export function num(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return Math.round(v).toLocaleString();
}

export const months = (m: number) => (m >= 12 ? `${(m / 12).toFixed(m % 12 ? 1 : 0)} yr` : `${Math.round(m)} mo`);
