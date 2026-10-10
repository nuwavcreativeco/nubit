'use client';
import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps, type Node } from '@xyflow/react';
import * as Icons from 'lucide-react';
import type { GNodeData } from '@/lib/graph/build';
import { money } from '@/lib/analytics/format';

type EntityNodeType = Node<GNodeData, 'entity'>;

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2];

function Icon({ name, className, style }: { name?: string; className?: string; style?: React.CSSProperties }) {
  const C = (name && (Icons as unknown as Record<string, Icons.LucideIcon>)[name]) || Icons.Circle;
  return <C className={className} style={style} strokeWidth={1.6} />;
}

const center: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' };

/** Growth arc around a node: clockwise = growth, counter-clockwise = decline. */
function GrowthRing({ size, growth }: { size: number; growth: number }) {
  const r = size / 2 + 5;
  const frac = Math.max(-1, Math.min(1, growth / 0.5));
  const a = frac * Math.PI * 1.5;
  const x = size / 2 + 5 + r * Math.sin(a), y = size / 2 + 5 - r * Math.cos(a);
  const large = Math.abs(a) > Math.PI ? 1 : 0;
  const sweep = a >= 0 ? 1 : 0;
  return (
    <svg className="pointer-events-none absolute" width={size + 10} height={size + 10} style={{ left: -5, top: -5 }}>
      <circle cx={size / 2 + 5} cy={size / 2 + 5} r={r} fill="none" stroke="var(--line)" strokeWidth="1" />
      {Math.abs(frac) > 0.01 && (
        <path d={`M ${size / 2 + 5} ${size / 2 + 5 - r} A ${r} ${r} 0 ${large} ${sweep} ${x} ${y}`} fill="none" stroke={growth >= 0 ? 'var(--pos)' : 'var(--neg)'} strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function RiskHalo({ size, risk, round, emphasize }: { size: number; risk: number; round: boolean; emphasize: boolean }) {
  // Outside Risk mode only serious bottlenecks glow, so the map isn't permanently red.
  if (risk < (emphasize ? 0.25 : 0.6)) return null;
  const color = risk >= 0.75 ? 'var(--critical)' : risk >= 0.5 ? 'var(--serious)' : 'var(--warning)';
  const pad = 6 + risk * 10;
  return (
    <>
      <div className="pointer-events-none absolute" style={{ inset: -pad, borderRadius: round ? '50%' : 6, boxShadow: `0 0 ${(emphasize ? 12 : 6) + risk * (emphasize ? 30 : 14)}px ${risk * (emphasize ? 6 : 2)}px color-mix(in oklch, ${color} ${Math.round(risk * (emphasize ? 45 : 28))}%, transparent)` }} />
      {risk >= (emphasize ? 0.5 : 0.75) && <div className="risk-pulse pointer-events-none absolute" style={{ inset: -4, borderRadius: round ? '50%' : 6, border: `1.5px solid ${color}` }} />}
    </>
  );
}

function EntityNodeImpl({ data, selected }: NodeProps<EntityNodeType>) {
  const zoom = useStore(zoomSelector);
  const d = data;
  const s = d.size;
  const lod = zoom < 0.32 ? 0 : zoom < 0.6 ? 1 : 2; // 0 = shape only, 1 = name, 2 = full detail
  const showText = lod > 0 || d.kind === 'parent' || d.kind === 'vertical';
  const isSel = selected || d.selected;
  const opacity = d.dim ? 0.16 : 1;
  const ring = isSel ? '0 0 0 2px var(--fg)' : d.highlight || d.matched ? `0 0 0 2px ${d.matched ? 'var(--accent)' : d.color}` : 'none';

  const handles = (
    <>
      <Handle type="target" position={Position.Top} style={center} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={center} isConnectable={false} />
    </>
  );

  const opportunity = d.opportunity > 0 && (d.mode === 'growth' || d.kind === 'acquisition') && (
    <div className="num absolute -right-2 -top-2 z-10 whitespace-nowrap border border-[color-mix(in_oklch,var(--pos)_50%,transparent)] bg-[color-mix(in_oklch,var(--pos)_14%,var(--bg))] px-1 py-px text-[10px] text-pos">
      +{money(d.opportunity)}
    </div>
  );
  const riskBadge = d.riskCount > 0 && (d.mode === 'risk' || d.risk >= 0.5) && lod > 0 && (
    <div className="absolute -left-2 -top-2 z-10 flex items-center gap-0.5 border bg-bg px-1 py-px text-[10px]" style={{ borderColor: d.risk >= 0.75 ? 'var(--critical)' : 'var(--serious)', color: d.risk >= 0.75 ? 'var(--critical)' : 'var(--serious)' }}>
      <Icons.TriangleAlert className="size-2.5" />{d.riskCount}
    </div>
  );

  if (d.kind === 'parent' || d.kind === 'vertical' || d.kind === 'cluster' || d.kind === 'acquisition') {
    const isParent = d.kind === 'parent';
    const dashed = d.kind === 'cluster' || d.kind === 'acquisition' || d.ghost;
    return (
      <div className="relative" style={{ width: s, height: s, opacity }} title={d.label}>
        {handles}
        <RiskHalo size={s} risk={d.risk} round emphasize={d.mode === 'risk'} />
        {d.growth !== null && d.kind === 'vertical' && lod > 0 && <GrowthRing size={s} growth={d.growth} />}
        <div
          className="grid size-full place-items-center rounded-full text-center transition-[box-shadow]"
          style={{
            background: isParent ? 'radial-gradient(circle at 50% 40%, #1d2026 0%, #0d0f13 70%)' : `color-mix(in oklch, ${d.color} 14%, var(--bg))`,
            border: `${isParent ? 1 : 2}px ${dashed ? 'dashed' : 'solid'} ${d.color}`,
            boxShadow: isParent ? `0 0 0 6px var(--bg), 0 0 0 7px color-mix(in oklch, ${d.color} 45%, transparent), ${ring}` : ring,
          }}
        >
          <div className="flex flex-col items-center px-2 leading-tight">
            {lod > 0 && <Icon name={d.icon} className={isParent ? 'mb-1 size-5' : 'mb-0.5 size-3.5'} style={{ color: d.color }} />}
            {showText && <div className={`font-medium text-fg ${isParent ? 'text-[13px]' : s > 100 ? 'text-[12px]' : 'text-[11px]'}`}>{d.label}</div>}
            {lod > 0 && <div className={`num mt-0.5 ${isParent ? 'text-[15px] text-fg' : 'text-[11px] text-fg-2'}`}>{d.valueLabel}</div>}
            {lod > 1 && (isParent || s > 96) && <div className="mt-0.5 text-[9px] text-muted">{d.sublabel}</div>}
          </div>
        </div>
        {d.badge && lod > 0 && (
          <div className="num absolute -bottom-1.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap border border-line-2 bg-panel px-1.5 py-px text-[9px] text-fg-2">
            {d.kind === 'cluster' ? `+ ${d.badge}` : `${d.badge} inside`}
          </div>
        )}
        {d.expanded && lod > 0 && <div className="absolute -bottom-1.5 left-1/2 z-10 -translate-x-1/2 border border-line-2 bg-panel px-1.5 py-px text-[9px] text-muted">collapse</div>}
        {opportunity}
        {riskBadge}
      </div>
    );
  }

  // Products: pills. Segments: hexagons. Infrastructure: diamonds. Shared teams: squares.
  const shapeStyle: React.CSSProperties =
    d.kind === 'segment'
      ? { clipPath: 'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)' }
      : d.kind === 'infra'
        ? { transform: 'rotate(45deg) scale(0.74)', borderRadius: 3 }
        : d.kind === 'function'
          ? { borderRadius: 2 }
          : { borderRadius: 999 };
  const w = d.kind === 'product' ? Math.max(s * 1.9, 96) : s;
  const h = d.kind === 'product' ? Math.max(26, s * 0.55) : s;
  return (
    <div className="relative" style={{ width: w, height: h, opacity }} title={d.label}>
      {handles}
      <RiskHalo size={s} risk={d.risk} round={d.kind !== 'product'} emphasize={d.mode === 'risk'} />
      <div
        className="absolute inset-0"
        style={{
          ...shapeStyle,
          background: d.kind === 'segment' ? `color-mix(in oklch, ${d.color} 22%, var(--bg))` : `color-mix(in oklch, ${d.color} 12%, var(--bg))`,
          border: d.kind === 'segment' ? undefined : `1.5px ${d.ghost || d.kind === 'function' ? 'dashed' : 'solid'} ${d.color}`,
          boxShadow: d.kind === 'segment' ? undefined : ring,
        }}
      />
      {d.kind === 'segment' && <div className="absolute inset-[2px]" style={{ ...shapeStyle, background: 'var(--bg)', opacity: 0.55 }} />}
      {d.kind === 'segment' && (isSel || d.matched) && <div className="absolute -inset-1 border" style={{ ...shapeStyle, borderColor: isSel ? 'var(--fg)' : 'var(--accent)' }} />}
      <div className="relative grid size-full place-items-center px-2 text-center leading-tight">
        <div className="min-w-0">
          {d.kind !== 'product' && lod > 1 && <Icon name={d.icon} className="mx-auto mb-0.5 size-3" style={{ color: d.color }} />}
          {showText && <div className={`truncate text-fg ${d.kind === 'product' ? 'text-[11px]' : 'text-[10px]'}`} style={{ maxWidth: d.kind === 'product' ? w - 14 : s + 30 }}>{d.label}</div>}
          {lod > 1 && <div className="num truncate text-[10px] text-fg-2">{d.valueLabel}</div>}
        </div>
      </div>
      {opportunity}
      {riskBadge}
    </div>
  );
}

export const EntityNode = memo(EntityNodeImpl);
