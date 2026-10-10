'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import type { DataStatus } from '@/lib/domain/types';
import { STATUS_HINT, STATUS_LABEL } from '@/lib/domain/provenance';
import { METRICS, type MetricKey } from '@/lib/analytics/explain';

const STATUS_SHORT: Record<DataStatus, string> = { actual: 'ACT', estimated: 'EST', projected: 'PROJ', ai: 'AI', user: 'USER' };

export function StatusBadge({ status, long = false }: { status: DataStatus; long?: boolean }) {
  return (
    <span
      title={`${STATUS_LABEL[status]} — ${STATUS_HINT[status]}`}
      className="inline-flex shrink-0 items-center gap-1 border px-1 py-px font-mono text-[9px] leading-none tracking-[0.08em]"
      style={{ color: `var(--st-${status})`, borderColor: `color-mix(in oklch, var(--st-${status}) 35%, transparent)` }}
    >
      <span className="size-1 rounded-full" style={{ background: `var(--st-${status})` }} />
      {long ? STATUS_LABEL[status].toUpperCase() : STATUS_SHORT[status]}
    </span>
  );
}

/** A labelled number that explains itself: click to see the formula, provenance and inputs. */
export function Metric({
  label, value, status, metric, sub, delta, inputs, size = 'md',
}: {
  label: string; value: ReactNode; status: DataStatus; metric?: MetricKey; sub?: ReactNode; delta?: { text: string; good: boolean } | null;
  inputs?: [string, string][]; size?: 'sm' | 'md' | 'lg';
}) {
  const [open, setOpen] = useState(false);
  // Open leftwards when a right-aligned popover would run off the screen.
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const def = metric ? METRICS[metric] : null;
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" onClick={() => { const r = ref.current?.getBoundingClientRect(); setAlignRight(!!r && r.left + 296 > window.innerWidth); setOpen((o) => !o); }} className="group block w-full min-w-0 text-left" aria-expanded={open}>
        <div className="flex items-center gap-1.5">
          <span className="label truncate">{label}</span>
          <StatusBadge status={status} />
          <Info className="size-2.5 shrink-0 text-dim opacity-0 transition group-hover:opacity-100" />
        </div>
        <div className={`num mt-1 truncate text-fg ${size === 'lg' ? 'text-[26px] leading-7' : size === 'md' ? 'text-[17px] leading-5' : 'text-[13px]'}`}>{value}</div>
        {(sub || delta) && (
          <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-muted">
            {delta && <span className="num" style={{ color: delta.good ? 'var(--pos)' : 'var(--neg)' }}>{delta.good ? '▲' : '▼'} {delta.text}</span>}
            {sub}
          </div>
        )}
      </button>
      {open && (
        <div className={`fade-in absolute top-full z-50 mt-1 w-72 ${alignRight ? 'right-0' : 'left-0'} border border-line-2 bg-panel-3 p-3 shadow-2xl shadow-black/60`}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="text-[12px] font-medium text-fg">{def?.label ?? label}</div>
            <button onClick={() => setOpen(false)} aria-label="Close"><X className="size-3 text-muted" /></button>
          </div>
          <div className="mb-2 flex items-center gap-2"><StatusBadge status={status} long /></div>
          <p className="mb-2 text-[11px] leading-relaxed text-fg-2">{STATUS_HINT[status]}</p>
          {def && (
            <>
              <div className="label mb-1">Formula</div>
              <p className="num mb-2 text-[11px] leading-relaxed text-fg">{def.formula}</p>
              {'notes' in def && typeof def.notes === 'string' && <p className="mb-2 text-[11px] leading-relaxed text-muted">{def.notes}</p>}
            </>
          )}
          {inputs && inputs.length > 0 && (
            <>
              <div className="label mb-1">Inputs</div>
              <div className="space-y-0.5">
                {inputs.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-[11px]"><span className="text-muted">{k}</span><span className="num text-fg">{v}</span></div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Section({ title, right, children, className = '' }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border-b border-line px-4 py-3.5 ${className}`}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="label !text-fg-2">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, right, children, className = '' }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`border border-line bg-panel ${className}`}>
      <div className="flex h-9 items-center justify-between gap-2 border-b border-line px-3">
        <h3 className="label !text-fg-2">{title}</h3>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'sm' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'xs' }) {
  return (
    <div className="inline-flex border border-line bg-panel">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`border-r border-line last:border-r-0 ${size === 'xs' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-[12px]'} transition ${o.value === value ? 'bg-panel-3 text-fg shadow-[inset_0_-1px_0_var(--accent)]' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Btn({ children, onClick, variant = 'ghost', className = '', title, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; variant?: 'ghost' | 'primary' | 'outline' | 'danger'; className?: string; title?: string; disabled?: boolean; type?: 'button' | 'submit' }) {
  const v = {
    ghost: 'text-fg-2 hover:bg-panel-3 hover:text-fg',
    outline: 'border border-line-2 text-fg-2 hover:border-muted hover:text-fg',
    primary: 'bg-accent text-black hover:brightness-110 font-medium',
    danger: 'border border-[color-mix(in_oklch,var(--neg)_40%,transparent)] text-neg hover:bg-[color-mix(in_oklch,var(--neg)_12%,transparent)]',
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, baseline, status = 'user' }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; baseline?: number; status?: DataStatus }) {
  const changed = baseline !== undefined && Math.abs(value - baseline) > 1e-9;
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] text-fg-2">{label}{changed && <StatusBadge status={status} />}</span>
        <span className="num text-[12px]" style={{ color: changed ? 'var(--accent)' : 'var(--fg)' }}>{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      {baseline !== undefined && (
        <div className="mt-0.5 flex justify-between text-[10px] text-dim">
          <span className="num">{format(min)}</span>
          <button type="button" className="hover:text-fg-2" onClick={() => onChange(baseline)}>baseline {format(baseline)}</button>
          <span className="num">{format(max)}</span>
        </div>
      )}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-[12px] text-muted">{children}</div>;
}

export function SeverityTag({ severity }: { severity: number }) {
  const s = severity >= 0.75 ? ['critical', 'Critical'] : severity >= 0.5 ? ['serious', 'Serious'] : severity >= 0.25 ? ['warning', 'Watch'] : ['good', 'Low'];
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: `var(--${s[0]})` }}>
      <span className="inline-block size-1.5" style={{ background: `var(--${s[0]})`, transform: 'rotate(45deg)' }} />
      {s[1]}
    </span>
  );
}
