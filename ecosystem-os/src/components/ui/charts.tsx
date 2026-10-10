'use client';
import { useState, type ReactNode } from 'react';

// Small hand-built SVG charts. Thin marks, recessive axes, a hover tooltip on every mark,
// text in ink colours (never the series colour).

interface Tip { x: number; y: number; content: ReactNode }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full border border-line-2 bg-panel-3 px-2 py-1.5 text-[11px] shadow-xl shadow-black/50" style={{ left: tip.x, top: tip.y - 6 }}>
      {tip.content}
    </div>
  );
}

/** Horizontal bars with direct labels. */
export function BarList({ items, format, max: maxIn }: { items: { id: string; label: ReactNode; value: number; color?: string; sub?: ReactNode; onClick?: () => void }[]; format: (v: number) => string; max?: number }) {
  const max = maxIn ?? Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <button key={i.id} type="button" onClick={i.onClick} className="group block w-full text-left" disabled={!i.onClick}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-fg-2 group-enabled:group-hover:text-fg">{i.label}</span>
            <span className="num shrink-0 text-fg">{format(i.value)}</span>
          </div>
          <div className="h-[5px] w-full bg-panel-3">
            <div className="h-full rounded-r-[2px]" style={{ width: `${Math.max(1, (Math.abs(i.value) / max) * 100)}%`, background: i.color ?? 'var(--fg-2)', opacity: i.value < 0 ? 0.5 : 1 }} />
          </div>
          {i.sub && <div className="mt-0.5 text-[10px] text-muted">{i.sub}</div>}
        </button>
      ))}
    </div>
  );
}

/** One stacked bar showing composition, with a legend underneath. */
export function MixBar({ items, format }: { items: { id: string; label: string; value: number; color: string }[]; format: (v: number) => string }) {
  const total = items.reduce((a, i) => a + Math.max(0, i.value), 0) || 1;
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <div className="relative">
      <div className="flex h-3 w-full gap-[2px]" onMouseLeave={() => setTip(null)}>
        {items.filter((i) => i.value > 0).map((i) => (
          <div
            key={i.id}
            className="h-full first:rounded-l-[2px] last:rounded-r-[2px]"
            style={{ width: `${(i.value / total) * 100}%`, background: i.color }}
            onMouseMove={(e) => {
              const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              setTip({ x: e.clientX - r.left, y: 0, content: <><div className="text-fg">{i.label}</div><div className="num text-fg-2">{format(i.value)} · {((i.value / total) * 100).toFixed(0)}%</div></> });
            }}
          />
        ))}
      </div>
      <Tooltip tip={tip} />
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-fg-2"><span className="size-2 shrink-0 rounded-[1px]" style={{ background: i.color }} />{i.label}</span>
            <span className="num text-muted">{((i.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Columns over time; projected years are hatched so they never read as actuals. */
export function YearColumns({ rows, format, height = 120, highlight }: { rows: { year: number; value: number; projected: boolean; base?: number }[]; format: (v: number) => string; height?: number; highlight?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const max = Math.max(...rows.map((r) => Math.max(r.value, r.base ?? 0)), 1e-9);
  const w = 100 / rows.length;
  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} onMouseLeave={() => setTip(null)}>
        <defs>
          <pattern id="hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="3" fill="var(--st-projected)" opacity="0.25" />
            <line x1="0" y1="0" x2="0" y2="3" stroke="var(--st-projected)" strokeWidth="1.4" />
          </pattern>
        </defs>
        <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} stroke="var(--line-2)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        {rows.map((r, i) => {
          const h = (r.value / max) * (height - 18);
          const x = i * w + w * 0.2;
          return (
            <g key={r.year}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({ x: ((i + 0.5) * w * box.width) / 100, y: ((height - h) * box.height) / height, content: <><div className="text-fg">{r.year} {r.projected ? '· projected' : '· actual'}</div><div className="num text-fg-2">{format(r.value)}{r.base !== undefined && Math.abs(r.base - r.value) > 1 ? ` (baseline ${format(r.base)})` : ''}</div></> });
              }}>
              <rect x={i * w} y={0} width={w} height={height} fill="transparent" />
              {r.base !== undefined && r.base > r.value + 1 && <rect x={x} y={height - (r.base / max) * (height - 18)} width={w * 0.6} height={(r.base / max) * (height - 18)} fill="none" stroke="var(--dim)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
              <rect x={x} y={height - h} width={w * 0.6} height={h} fill={r.projected ? 'url(#hatch)' : 'var(--fg-2)'} opacity={highlight === undefined || highlight === r.year ? 1 : 0.55} />
              {r.base !== undefined && r.base < r.value - 1 && <line x1={x} x2={x + w * 0.6} y1={height - (r.base / max) * (height - 18)} y2={height - (r.base / max) * (height - 18)} stroke="var(--bg)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex">
        {rows.map((r) => <div key={r.year} className="num text-center text-[10px] text-muted" style={{ width: `${w}%`, color: highlight === r.year ? 'var(--fg)' : undefined }}>{r.year}</div>)}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Semicircle score gauge — a single headline number, so the number does the work. */
export function ScoreGauge({ score, label, size = 132 }: { score: number; label: string; size?: number }) {
  const r = size / 2 - 8;
  const a = Math.PI * (score / 100);
  const x = size / 2 - r * Math.cos(a), y = size / 2 - r * Math.sin(a);
  const color = score >= 70 ? 'var(--pos)' : score >= 50 ? 'var(--warning)' : 'var(--neg)';
  return (
    <div className="relative" style={{ width: size, height: size / 2 + 22 }}>
      <svg width={size} height={size / 2 + 4}>
        <path d={`M 8 ${size / 2} A ${r} ${r} 0 0 1 ${size - 8} ${size / 2}`} fill="none" stroke="var(--panel-3)" strokeWidth="6" />
        <path d={`M 8 ${size / 2} A ${r} ${r} 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-x-0 text-center" style={{ top: size / 2 - 26 }}>
        <div className="num text-[28px] leading-none text-fg">{score}</div>
        <div className="label mt-1">{label}</div>
      </div>
    </div>
  );
}

/** Square matrix heat map (sequential, single hue). */
export function Heatmap({ labels, values, format, onCell, colorFor }: { labels: { id: string; label: string; color?: string }[]; values: (a: string, b: string) => number | null; format: (v: number) => string; onCell?: (a: string, b: string) => void; colorFor?: (v: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const all = labels.flatMap((a) => labels.map((b) => (a.id === b.id ? null : values(a.id, b.id)))).filter((v): v is number => v !== null);
  const max = Math.max(...all, 1e-9);
  const seq = colorFor ?? ((v: number) => `color-mix(in oklch, #3987e5 ${Math.round(12 + (v / max) * 88)}%, var(--panel-2))`);
  // Column headers are narrow: drop leading words every label shares ("NuWav Music", "NuWav World" → "Music", "World").
  const words = labels.map((l) => l.label.split(' '));
  let common = 0;
  while (labels.length > 1 && words.every((w) => w.length > common + 1 && w[common] === words[0][common])) common++;
  const short = (i: number) => words[i].slice(common).join(' ');
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `88px repeat(${labels.length}, minmax(0, 1fr))` }}>
        <div />
        {labels.map((l, i) => <div key={l.id} className="truncate pb-1 text-center text-[9px] text-muted" title={l.label}>{short(i)}</div>)}
        {labels.map((row) => (
          <div key={row.id} className="contents">
            <div className="flex items-center gap-1.5 truncate pr-1 text-[11px] text-fg-2">{row.color && <span className="size-1.5 shrink-0" style={{ background: row.color }} />}{row.label}</div>
            {labels.map((col) => {
              const v = row.id === col.id ? null : values(row.id, col.id);
              return (
                <button
                  key={col.id}
                  type="button"
                  disabled={v === null}
                  onClick={() => v !== null && onCell?.(row.id, col.id)}
                  onMouseMove={(e) => {
                    if (v === null) return setTip(null);
                    const box = (e.currentTarget.closest('.relative') as HTMLElement).getBoundingClientRect();
                    const r = e.currentTarget.getBoundingClientRect();
                    setTip({ x: r.left - box.left + r.width / 2, y: r.top - box.top, content: <><div className="text-fg">{row.label} ↔ {col.label}</div><div className="num text-fg-2">{format(v)}</div></> });
                  }}
                  className="num grid aspect-square place-items-center text-[10px] text-fg disabled:cursor-default"
                  style={{ background: v === null ? 'var(--panel)' : seq(v) }}
                >
                  {v === null ? '' : format(v)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Opportunity bubbles: x = time to implement, y = confidence, area = revenue. */
export function BubbleChart({ items, height = 240, onClick, selected }: { items: { id: string; x: number; y: number; r: number; color: string; label: string; detail: ReactNode }[]; height?: number; onClick?: (id: string) => void; selected?: string | null }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const maxX = Math.max(...items.map((i) => i.x), 12);
  const maxR = Math.max(...items.map((i) => i.r), 1e-9);
  const W = 400, H = height, pad = 28;
  const sx = (x: number) => pad + (x / maxX) * (W - pad - 10);
  const sy = (y: number) => H - pad - y * (H - pad - 10);
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
        {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={pad} x2={W - 10} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth="1" />)}
        <line x1={pad} x2={W - 10} y1={H - pad} y2={H - pad} stroke="var(--line-2)" />
        {[0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={pad - 4} y={sy(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" className="num">{t * 100}%</text>)}
        {[0, 3, 6, 9, 12].filter((m) => m <= maxX).map((m) => <text key={m} x={sx(m)} y={H - pad + 13} textAnchor="middle" fontSize="9" fill="var(--muted)" className="num">{m}mo</text>)}
        <text x={W - 10} y={H - 4} textAnchor="end" fontSize="9" fill="var(--dim)">time to implement →</text>
        <text x={4} y={10} fontSize="9" fill="var(--dim)">confidence</text>
        {[...items].sort((a, b) => b.r - a.r).map((i) => {
          const rad = 4 + Math.sqrt(i.r / maxR) * 22;
          return (
            <circle
              key={i.id}
              cx={sx(i.x)} cy={sy(i.y)} r={rad}
              fill={i.color} fillOpacity={selected && selected !== i.id ? 0.18 : 0.55}
              stroke={selected === i.id ? 'var(--fg)' : 'var(--bg)'} strokeWidth={selected === i.id ? 1.5 : 2}
              className="cursor-pointer transition"
              onClick={() => onClick?.(i.id)}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({ x: (sx(i.x) / W) * box.width, y: ((sy(i.y) - rad) / H) * box.height, content: <><div className="max-w-56 text-fg">{i.label}</div><div className="text-fg-2">{i.detail}</div></> });
              }}
            />
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export function Spark({ values, width = 64, height = 18, color = 'var(--fg-2)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / Math.max(max - min, 1e-9)) * (height - 4)}`).join(' ');
  return <svg width={width} height={height}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
