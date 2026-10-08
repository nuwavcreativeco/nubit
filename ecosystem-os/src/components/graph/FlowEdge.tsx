'use client';
import { memo, useState } from 'react';
import { EdgeLabelRenderer, useStore, type EdgeProps, type Edge } from '@xyflow/react';
import type { GEdgeData } from '@/lib/graph/build';
import { EDGE_STYLES } from '@/lib/graph/theme';

type FlowEdgeType = Edge<GEdgeData, 'flow'>;

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2];

/** Quadratic curve between node centres; parallel relationships fan out via `curvature`. */
function FlowEdgeImpl({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<FlowEdgeType>) {
  const [hover, setHover] = useState(false);
  const zoom = useStore(zoomSelector);
  if (!data) return null;
  const dx = targetX - sourceX, dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const cx = (sourceX + targetX) / 2 + nx * len * data.curvature;
  const cy = (sourceY + targetY) / 2 + ny * len * data.curvature;
  const path = `M ${sourceX} ${sourceY} Q ${cx} ${cy} ${targetX} ${targetY}`;
  const at = (t: number) => ({ x: (1 - t) ** 2 * sourceX + 2 * (1 - t) * t * cx + t ** 2 * targetX, y: (1 - t) ** 2 * sourceY + 2 * (1 - t) * t * cy + t ** 2 * targetY });
  const mid = at(0.5);
  const opacity = data.dim ? 0.06 : data.kind === 'ownership' && !data.flow ? 0.9 : data.highlight || hover ? 1 : 0.42;
  const width = data.width * (hover ? 1.4 : 1);
  const showDetail = zoom > 0.35; // level of detail: particles and labels only when legible

  let arrow: string | null = null;
  if (data.arrow) {
    const p = at(0.62), q = at(0.6);
    const ang = Math.atan2(p.y - q.y, p.x - q.x);
    const s = 5 + data.width;
    arrow = `M ${p.x + Math.cos(ang) * s} ${p.y + Math.sin(ang) * s} L ${p.x + Math.cos(ang + 2.5) * s} ${p.y + Math.sin(ang + 2.5) * s} L ${p.x + Math.cos(ang - 2.5) * s} ${p.y + Math.sin(ang - 2.5) * s} Z`;
  }

  return (
    <>
      <path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(12, width + 8)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ pointerEvents: 'stroke' }} />
      <path
        id={id}
        d={path}
        fill="none"
        stroke={data.color}
        strokeWidth={width}
        strokeDasharray={data.dash}
        strokeLinecap={data.dash ? 'butt' : 'round'}
        opacity={opacity}
        className={data.march && !data.dim ? 'edge-march' : undefined}
        style={{ transition: 'opacity 180ms ease', pointerEvents: 'none' }}
      />
      {data.highlight && !data.dim && <path d={path} fill="none" stroke={data.color} strokeWidth={width + 6} opacity={0.12} style={{ pointerEvents: 'none' }} />}
      {arrow && <path d={arrow} fill={data.color} opacity={opacity} style={{ pointerEvents: 'none' }} />}
      {data.flow && showDetail &&
        Array.from({ length: data.particles }, (_, i) => (
          <circle key={i} r={data.kind === 'journey' ? 3.2 : 1.6 + data.width * 0.35} fill={data.kind === 'ownership' ? '#E5C26B' : data.color} opacity={0.95} style={{ pointerEvents: 'none' }}>
            <animateMotion dur={`${data.duration}s`} begin={`${(i * data.duration) / data.particles}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
      {(data.showLabel || hover) && data.label && !data.dim && (showDetail || hover) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute z-20 max-w-60 border bg-bg/95 px-1.5 py-0.5 text-[10px] leading-tight"
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`, borderColor: `color-mix(in oklch, ${data.color} 50%, transparent)`, color: 'var(--fg-2)' }}
          >
            <span className="num text-fg">{data.label}</span>
            {hover && (
              <div className="mt-0.5 text-muted">
                <span style={{ color: data.color }}>■</span> {EDGE_STYLES[data.kind].label}
                {data.note && <div className="text-fg-2">{data.note}</div>}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeImpl);
