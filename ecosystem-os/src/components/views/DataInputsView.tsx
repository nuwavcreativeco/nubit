'use client';
import { useMemo, useState } from 'react';
import { Check, RotateCcw, Save } from 'lucide-react';
import { useApp } from '@/store/app';
import { api } from '@/lib/data/client';
import { applyInputs, inputFields, type InputField, type InputFormat } from '@/lib/domain/inputs';
import { money, num, pct } from '@/lib/analytics/format';
import { Btn, Panel, StatusBadge } from '@/components/ui/primitives';

type Edit = number | 'confirm';

/** Today as YYYY-MM-DD in the viewer's time zone (toISOString would give the UTC date). */
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Percentages are typed as 0–100; everything else as plain numbers.
const toInput = (v: number, f: InputFormat) => (f === 'pct' ? String(Math.round(v * 1000) / 10) : String(Math.round(v * 100) / 100));
const fromInput = (s: string, f: InputFormat) => {
  const n = Number(s.replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return f === 'pct' ? n / 100 : n;
};
const show = (v: number, f: InputFormat) => (f === 'money' ? money(v) : f === 'pct' ? pct(v) : f === 'count' ? num(v) : String(Math.round(v * 100) / 100));

function Row({ f, edit, onEdit, showGroup }: { f: InputField; edit: Edit | undefined; onEdit: (e: Edit | undefined) => void; showGroup?: boolean }) {
  const [text, setText] = useState(toInput(f.value, f.format));
  const [bad, setBad] = useState(false);
  const status = edit !== undefined ? 'actual' : f.status;
  const commit = (s: string) => {
    const v = fromInput(s, f.format);
    setBad(v === null);
    if (v === null) return;
    onEdit(Math.abs(v - f.value) < 1e-9 ? (edit === 'confirm' ? 'confirm' : undefined) : v);
  };
  return (
    <div className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 border-t border-line px-3 py-2 first:border-t-0 sm:grid-cols-[1fr_150px_92px] ${edit !== undefined ? 'bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]' : ''}`}>
      <div className="min-w-0">
        {showGroup && <div className="label !text-[9px] !text-muted">{f.group}</div>}
        <div className="flex items-center gap-1.5 text-[12px] text-fg">{f.label}<StatusBadge status={status} /></div>
        {f.help && <div className="text-[10.5px] text-muted">{f.help}</div>}
        {edit !== undefined && edit !== 'confirm' && <div className="text-[10.5px] text-muted">was {show(f.value, f.format)}</div>}
      </div>
      <label className={`col-span-2 flex h-8 items-center gap-1 border bg-bg px-2 sm:col-span-1 focus-within:border-line-2 ${bad ? 'border-neg' : 'border-line'}`}>
        {f.format === 'money' && <span className="text-[11px] text-dim">$</span>}
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
          aria-label={`${f.group} — ${f.label}`}
          className="num min-w-0 flex-1 bg-transparent text-right text-[12px] text-fg outline-none"
        />
        {f.format === 'pct' && <span className="text-[11px] text-dim">%</span>}
      </label>
      <div className="col-span-2 flex justify-end sm:col-span-1">
        {f.status !== 'actual' && edit === undefined ? (
          <button onClick={() => onEdit('confirm')} className="flex items-center gap-1 text-[11px] text-muted hover:text-fg" title="Keep this value and mark it as your real number">
            <Check className="size-3" />It&apos;s right
          </button>
        ) : edit !== undefined ? (
          <button onClick={() => { setText(toInput(f.value, f.format)); setBad(false); onEdit(undefined); }} className="flex items-center gap-1 text-[11px] text-muted hover:text-fg">
            <RotateCcw className="size-3" />Undo
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function DataInputsView() {
  const s = useApp();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [onlyEst, setOnlyEst] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [round, setRound] = useState(0); // bumps to reset the text boxes after save/discard
  const fields = useMemo(() => (s.data ? inputFields(s.data) : []), [s.data]);
  if (!s.data) return null;

  const est = fields.filter((f) => f.status !== 'actual');
  const start = est.filter((f) => f.priority);
  const inStart = new Set(start.map((f) => f.id));
  const visible = fields.filter((f) => !inStart.has(f.id) && (!onlyEst || f.status !== 'actual' || edits[f.id] !== undefined));
  const groups = [...new Set(visible.map((f) => f.group))];
  const pending = Object.keys(edits).length;
  const setEdit = (id: string, e: Edit | undefined) => setEdits((cur) => {
    const next = { ...cur };
    if (e === undefined) delete next[id]; else next[id] = e;
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.saveCompany(applyInputs(s.data!, edits, localDate()));
      s.replaceCompany(saved);
      setMsg({ ok: true, text: `Saved ${pending} figure${pending === 1 ? '' : 's'}. Every view now uses them.` });
      setEdits({});
      setRound((r) => r + 1);
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setMsg({ ok: false, text: [err.message, ...(err.details ?? [])].join(' · ') });
    } finally {
      setSaving(false);
    }
  };

  const section = (title: string, list: InputField[], showGroup = false) => (
    <Panel key={title} title={title}>
      <div className="-mx-3 -my-3">{list.map((f) => <Row key={`${f.id}:${round}`} f={f} edit={edits[f.id]} onEdit={(e) => setEdit(f.id, e)} showGroup={showGroup} />)}</div>
    </Panel>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-5 max-w-3xl">
          <div className="label">Your numbers</div>
          <h1 className="mt-1 text-[20px] font-medium text-fg">Replace estimates with real figures</h1>
          <p className="text-[12px] text-muted">
            Anything marked <StatusBadge status="estimated" /> was filled in by the model. Type your real number, or tick “It&apos;s right” if the estimate is
            correct. Saved figures become <StatusBadge status="actual" /> and every score, opportunity and projection recalculates.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 bg-panel-3"><div className="h-full bg-accent" style={{ width: `${fields.length ? (100 * (fields.length - est.length)) / fields.length : 0}%` }} /></div>
            <span className="num shrink-0 text-[11px] text-fg-2">{fields.length - est.length} of {fields.length} confirmed</span>
          </div>
        </div>

        {msg && <div className={`mb-4 max-w-3xl border px-3 py-2 text-[12px] ${msg.ok ? 'border-[color-mix(in_oklch,var(--pos)_40%,transparent)] text-fg' : 'border-[color-mix(in_oklch,var(--neg)_40%,transparent)] text-neg'}`}>{msg.text}</div>}

        <div className="max-w-3xl space-y-4">
          {start.length > 0 && section('Start here — biggest effect on the analysis', start, true)}
          <div className="flex items-center justify-between pt-2">
            <div className="label">All figures by unit</div>
            <label className="flex items-center gap-1.5 text-[11px] text-fg-2"><input type="checkbox" checked={onlyEst} onChange={(e) => setOnlyEst(e.target.checked)} />Only show estimates</label>
          </div>
          {groups.map((g) => section(g, visible.filter((f) => f.group === g)))}
          {groups.length === 0 && <p className="text-[12px] text-muted">Every figure is confirmed. Untick “Only show estimates” to update any of them.</p>}
        </div>
      </div>

      {pending > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-line bg-panel px-4 py-2.5 sm:px-6">
          <span className="text-[12px] text-fg-2">{pending} change{pending === 1 ? '' : 's'} not saved</span>
          <div className="flex gap-2">
            <Btn variant="outline" onClick={() => { setEdits({}); setRound((r) => r + 1); }}>Discard</Btn>
            <Btn variant="primary" onClick={save} disabled={saving}><Save className="size-3.5" />{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
