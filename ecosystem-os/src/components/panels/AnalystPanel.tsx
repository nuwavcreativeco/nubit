'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Bot, Loader2, Wrench, User } from 'lucide-react';
import { useApp, type ChatMessage } from '@/store/app';
import { StatusBadge } from '@/components/ui/primitives';
import type { DataStatus } from '@/lib/domain/types';

const SUGGESTIONS = [
  'What is our biggest revenue opportunity?',
  'Which verticals should we combine?',
  'Where are we overdependent?',
  'Which customers should we cross-sell?',
  'What happens if customer growth increases by 20%?',
  'Which vertical should receive another $500K of investment?',
  'Which acquisition would make the most sense?',
  'Why is our synergy score low for Real Estate?',
  'What would happen if we removed Media?',
];

const TAG: Record<string, DataStatus> = { ACTUAL: 'actual', ESTIMATED: 'estimated', PROJECTED: 'projected', 'USER INPUT': 'user', 'AI PROJECTION': 'ai' };

/** Renders the analyst's markdown subset: bullets, **bold**, provenance tags and [[node:id|Name]] links. */
function RichText({ text }: { text: string }) {
  const select = useApp((s) => s.select);
  const inline = (line: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /\[\[node:([^|\]]+)\|([^\]]+)\]\]|\[(ACTUAL|ESTIMATED|PROJECTED|USER INPUT|AI PROJECTION)\]|\*\*([^*]+)\*\*/g;
    let last = 0, m: RegExpExecArray | null, i = 0;
    while ((m = re.exec(line))) {
      if (m.index > last) out.push(line.slice(last, m.index));
      if (m[1]) out.push(<button key={`${key}-${i++}`} onClick={() => select(m![1], { focus: true })} className="border-b border-dotted border-accent text-fg hover:text-accent">{m[2]}</button>);
      else if (m[3]) out.push(<span key={`${key}-${i++}`} className="mx-0.5 inline-block align-middle"><StatusBadge status={TAG[m[3]]} /></span>);
      else if (m[4]) out.push(<strong key={`${key}-${i++}`} className="font-medium text-fg">{m[4]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  };
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed text-fg-2">
      {lines.map((l, i) => {
        if (!l.trim()) return null;
        const bullet = /^\s*[-*•]\s+/.test(l);
        return bullet
          ? <div key={i} className="flex gap-2 pl-1"><span className="text-dim">–</span><span>{inline(l.replace(/^\s*[-*•]\s+/, ''), `l${i}`)}</span></div>
          : <p key={i}>{inline(l.replace(/^#+\s*/, ''), `l${i}`)}</p>;
      })}
    </div>
  );
}

const TOOL_LABEL: Record<string, string> = {
  get_company_overview: 'Read company overview', get_vertical_details: 'Inspected vertical', list_opportunities: 'Ran opportunity engine',
  get_synergies: 'Computed synergy scores', get_risks: 'Scanned risks & dependencies', get_offer_overlap: 'Analysed offer overlap',
  get_customer_segments: 'Read customer segments', get_health_breakdown: 'Read health score', run_scenario: 'Ran scenario',
  remove_vertical: 'Simulated removal', allocate_investment: 'Ranked investment returns', evaluate_acquisition: 'Evaluated acquisition',
  list_saved_acquisitions: 'Compared saved targets', get_projections: 'Read projections', explain_metric: 'Looked up formula',
};

export function AnalystPanel() {
  const s = useApp();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [s.chat]);

  const ask = useCallback(async (q: string) => {
    const st = useApp.getState();
    if (!q.trim() || !st.companyId || busy) return;
    setBusy(true);
    setInput('');
    const history = st.chat.filter((m) => !m.pending && !m.error && m.text).map((m) => ({ role: m.role, text: m.text }));
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: q, tools: [] };
    const reply: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: '', tools: [], pending: true };
    st.setChat((c) => [...c, userMsg, reply]);
    const patch = (fn: (m: ChatMessage) => ChatMessage) => useApp.getState().setChat((c) => c.map((m) => (m.id === reply.id ? fn(m) : m)));
    try {
      const res = await fetch('/api/analyst', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyId: st.companyId, question: q, year: st.year, scenario: st.scenario, history }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === 'text') patch((m) => ({ ...m, text: m.text + e.delta }));
          else if (e.type === 'tool') patch((m) => ({ ...m, tools: [...m.tools, { name: e.name, input: e.input }] }));
          else if (e.type === 'tool_result') patch((m) => ({ ...m, tools: m.tools.map((t, i) => (i === m.tools.length - 1 ? { ...t, ok: e.ok } : t)) }));
          else if (e.type === 'done') patch((m) => ({ ...m, pending: false, engine: e.engine }));
          else if (e.type === 'error') patch((m) => ({ ...m, pending: false, error: e.message }));
        }
      }
      patch((m) => ({ ...m, pending: false }));
    } catch (err) {
      patch((m) => ({ ...m, pending: false, error: err instanceof Error ? err.message : 'Failed' }));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Questions handed over from elsewhere (e.g. "Ask the analyst" in the inspector).
  const pending = useApp((x) => x.pendingQuestion);
  useEffect(() => {
    if (!pending || busy) return;
    useApp.getState().askAnalyst(null);
    ask(pending);
  }, [pending, busy, ask]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-2.5 text-[11px] leading-relaxed text-muted">
        The analyst answers only from the engine&apos;s calculations — it calls tools for every number and tags each one
        <span className="mx-1 inline-flex gap-1 align-middle"><StatusBadge status="actual" /><StatusBadge status="estimated" /><StatusBadge status="projected" /><StatusBadge status="user" /></span>.
        Its interpretation is marked <StatusBadge status="ai" />.
        {s.system?.ai === 'local' && <div className="mt-1 text-fg-2">No ANTHROPIC_API_KEY configured — using the deterministic analyst (same engine, templated answers).</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {s.chat.length === 0 && (
          <div className="space-y-1.5">
            <div className="label mb-2">Try asking</div>
            {SUGGESTIONS.map((q) => <button key={q} onClick={() => ask(q)} className="block w-full border border-line px-3 py-2 text-left text-[12px] text-fg-2 hover:border-line-2 hover:text-fg">{q}</button>)}
          </div>
        )}
        {s.chat.map((m) => (
          <div key={m.id} className="fade-in mb-4">
            <div className="mb-1.5 flex items-center gap-1.5">
              {m.role === 'user' ? <User className="size-3 text-muted" /> : <Bot className="size-3 text-[var(--st-ai)]" />}
              <span className="label !text-[9px]">{m.role === 'user' ? 'You' : m.engine === 'local' ? 'Deterministic analyst' : 'AI analyst'}</span>
              {m.role === 'assistant' && !m.pending && !m.error && <StatusBadge status="ai" long />}
            </div>
            {m.tools.length > 0 && (
              <div className="mb-2 space-y-0.5">
                {m.tools.map((t, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10.5px] text-muted">
                    <Wrench className="size-2.5" />{TOOL_LABEL[t.name] ?? t.name}
                    {!!t.input && Object.keys(t.input as object).length > 0 && <span className="num truncate text-dim">{JSON.stringify(t.input).slice(0, 60)}</span>}
                    {t.ok === false && <span className="text-neg">failed</span>}
                  </div>
                ))}
              </div>
            )}
            {m.role === 'user' ? <p className="text-[13px] text-fg">{m.text}</p> : <RichText text={m.text} />}
            {m.pending && <Loader2 className="mt-2 size-3.5 animate-spin text-muted" />}
            {m.error && <p className="mt-2 text-[12px] text-neg">{m.error}</p>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="border-t border-line p-3">
        <div className="flex items-end gap-2 border border-line bg-bg px-2.5 py-2 focus-within:border-line-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            rows={2}
            placeholder="Ask about the graph…"
            className="min-w-0 flex-1 resize-none bg-transparent text-[12.5px] text-fg outline-none placeholder:text-dim"
          />
          <button type="submit" disabled={busy || !input.trim()} className="grid size-7 place-items-center bg-accent text-black disabled:opacity-30" aria-label="Send"><ArrowUp className="size-4" /></button>
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-dim">
          <span>Context: {s.year}{JSON.stringify(s.scenario) !== JSON.stringify(s.baseline) ? ' · with active scenario' : ''}</span>
          {s.chat.length > 0 && <button type="button" onClick={() => s.setChat(() => [])} className="hover:text-fg-2">Clear</button>}
        </div>
      </form>
    </div>
  );
}
