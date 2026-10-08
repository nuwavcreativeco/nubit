'use client';
import { useMemo, useState } from 'react';
import { Bot, X, ArrowRight } from 'lucide-react';
import { useApp } from '@/store/app';
import { useAnalysis } from '@/store/useAnalysis';
import { computeState } from '@/lib/analytics/model';
import { potentialFor } from '@/lib/analytics/potential';
import { riskScore } from '@/lib/analytics/bottlenecks';
import { money, num, pct, sum } from '@/lib/analytics/format';
import { assignVerticalColors, KIND_COLOR } from '@/lib/graph/theme';
import { fieldStatus, periodStatus } from '@/lib/domain/provenance';
import { Metric, Section, SeverityTag, StatusBadge, Segmented } from '@/components/ui/primitives';
import { BarList, YearColumns } from '@/components/ui/charts';

type Tab = 'financial' | 'growth' | 'strategic' | 'scaling';

export function Inspector() {
  const s = useApp();
  const a = useAnalysis();
  const [tab, setTab] = useState<Tab>('financial');
  const data = s.data!;
  const id = s.selectedId!;
  const colors = useMemo(() => assignVerticalColors(data.verticals), [data.verticals]);

  const history = useMemo(() => {
    if (!s.scenario || !s.baseline) return [];
    return data.parent.years.map((y) => {
      const st = computeState(data, y, s.scenario!, s.baseline!);
      const base = computeState(data, y, s.baseline!, s.baseline!);
      const pick = (x: typeof st) => id === 'parent' ? x.revenue : x.verticals.find((v) => v.id === id)?.revenue ?? x.products[id]?.revenue ?? x.segments.find((g) => g.id === id)?.revenue ?? 0;
      return { year: y, value: pick(st), base: pick(base), projected: y > data.parent.currentYear || (y === data.parent.currentYear && JSON.stringify(s.scenario) !== JSON.stringify(s.baseline)) };
    });
  }, [data, id, s.scenario, s.baseline]);

  if (!a) return null;
  const ctx = a.status;
  const ps = periodStatus(ctx);
  const st = a.state;
  const vs = st.verticals.find((v) => v.id === id);
  const prod = st.products[id];
  const seg = st.segments.find((g) => g.id === id);
  const infra = data.infra.find((i) => i.id === id);
  const fn = data.functions.find((f) => f.id === id);
  const isParent = id === 'parent';
  const bns = a.bottlenecks.filter((b) => b.nodeId === id);
  const pot = potentialFor(id, data, a, s.baseline!);
  const vName = (vid: string) => data.verticals.find((v) => v.id === vid)?.name ?? vid;

  const kind = isParent ? 'Parent company' : vs ? 'Vertical' : prod ? `Product · ${vName(prod.p.vertical)}` : seg ? 'Customer segment' : infra ? 'Infrastructure' : fn ? 'Shared team' : id === 'acquisition' ? 'Acquisition target' : 'Node';
  const name = isParent ? data.parent.name : vs?.v.name ?? prod?.p.name ?? seg?.s.name ?? infra?.name ?? fn?.name ?? s.acquisitionDraft?.name ?? id;
  const color = vs ? colors[vs.id]?.base : prod ? colors[prod.p.vertical]?.base : seg ? KIND_COLOR.segment : infra ? KIND_COLOR.infra : fn ? KIND_COLOR.function : KIND_COLOR.parent;
  const description = isParent ? data.parent.tagline : vs?.v.description ?? seg?.s.description ?? (infra ? `${infra.category.toUpperCase()} system shared by ${infra.dependents.length} verticals` : fn ? `Shared team serving ${fn.serves.length} verticals` : undefined);
  const risk = riskScore(bns);

  const ask = () => {
    s.askAnalyst(`Give me a full assessment of ${name}: how it contributes to the group, its biggest risks and the best way to grow it.`);
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: 'financial', label: 'Financial' }, { value: 'growth', label: 'Growth' }, { value: 'strategic', label: 'Strategic' }, { value: 'scaling', label: 'Scaling' },
  ];

  return (
    <aside className="fade-in flex w-[380px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="label flex items-center gap-1.5"><span className="size-2" style={{ background: color }} />{kind}</div>
            <h2 className="mt-1 truncate text-[17px] font-medium text-fg">{name}</h2>
            {description && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{description}</p>}
          </div>
          <button onClick={() => s.select(null)} aria-label="Close" className="text-muted hover:text-fg"><X className="size-4" /></button>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          {bns.length > 0 && <span className="text-[11px] text-muted">Risk <span className="num text-fg">{risk}</span></span>}
          {bns[0] && <SeverityTag severity={bns[0].severity} />}
          <button onClick={ask} className="ml-auto flex items-center gap-1 text-[11px] text-fg-2 hover:text-accent"><Bot className="size-3.5" />Ask the analyst</button>
        </div>
      </div>
      <div className="border-b border-line px-4 py-2"><Segmented<Tab> size="xs" value={tab} onChange={setTab} options={tabs} /></div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Parent ── */}
        {isParent && tab === 'financial' && (
          <Section title="Consolidated">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Metric label="Total revenue" value={money(st.revenue)} status={ps} metric="revenue" />
              <Metric label="Revenue growth" value={pct(st.growth, { sign: true, digits: 1 })} status={ps} metric="growth" inputs={[['This year', money(st.revenue)], ['Prior year', money(st.prevRevenue)]]} />
              <Metric label="EBITDA" value={money(st.ebitda)} status={ps} metric="ebitda" sub={`${pct(st.ebitdaMargin)} margin`} />
              <Metric label="Verticals" value={st.active.length} status="actual" />
              <Metric label="Customers" value={num(st.customers)} status={ps} />
              <Metric label="Employees" value={st.employees} status={ps} />
              <Metric label="Recurring revenue" value={money(st.recurringRevenue)} status={ps} metric="recurring" sub={`${pct(st.recurringShare)} of total`} />
              <Metric label="Enterprise value" value={money(a.valuation.ev)} status="estimated" metric="valuation" sub={`${a.valuation.multiple.toFixed(1)}× EBITDA`} inputs={[['EBITDA', money(st.ebitda)], ['Growth (capped 35%)', pct(Math.min(st.growth, 0.35))], ['Recurring share', pct(st.recurringShare)], ['Health', `${a.health.score}`]]} />
            </div>
          </Section>
        )}

        {/* ── Vertical ── */}
        {vs && tab === 'financial' && (() => {
          const v = vs.v;
          const o = v.status;
          return (
            <>
              <Section title="Profit & loss">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Metric label="Revenue" value={money(vs.revenue)} status={ps} metric="revenue" delta={a.scenarioActive && vs.baseRevenue ? { text: pct(vs.revenue / vs.baseRevenue - 1, { digits: 1 }), good: vs.revenue >= vs.baseRevenue } : null} />
                  <Metric label="Growth" value={pct(vs.growth, { sign: true, digits: 1 })} status={ps} metric="growth" inputs={[['This year', money(vs.revenue)], ['Prior year', money(vs.prevRevenue)]]} />
                  <Metric label="Gross margin" value={pct(v.grossMargin)} status={fieldStatus('grossMargin', ctx, o)} metric="grossMargin" />
                  <Metric label="EBITDA" value={money(vs.ebitda)} status={ps} metric="ebitda" sub={`${pct(vs.ebitdaMargin)} margin`} />
                  <Metric label="Contribution margin" value={pct(v.contributionMargin)} status={fieldStatus('contributionMargin', ctx, o)} metric="contributionMargin" />
                  <Metric label="Recurring / one-time" value={`${money(vs.recurringRevenue)}`} status={ps} metric="recurring" sub={`${money(vs.revenue - vs.recurringRevenue)} one-time`} />
                </div>
              </Section>
              <Section title="Unit economics">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Metric label="Revenue / customer" value={money(vs.arpc)} status={ps} metric="revenuePerCustomer" inputs={[['Revenue', money(vs.revenue)], ['Customers', num(vs.customers)]]} />
                  <Metric label="Revenue / employee" value={money(vs.revenue / Math.max(1, vs.employees))} status={ps} metric="revenuePerEmployee" inputs={[['Employees', String(vs.employees)]]} />
                  <Metric label="CAC" value={money(v.cac)} status={fieldStatus('cac', ctx, o)} metric="cac" />
                  <Metric label="LTV" value={money(v.ltv)} status={fieldStatus('ltv', ctx, o)} metric="ltv" />
                  <Metric label="LTV : CAC" value={`${(v.ltv / Math.max(1, v.cac)).toFixed(1)}×`} status="estimated" metric="ltvCac" />
                  <Metric label="Retention" value={pct(v.retention)} status={fieldStatus('retention', ctx, o)} metric="retention" />
                  <Metric label="Customers" value={num(vs.customers)} status={ps} />
                  <Metric label="Employees" value={vs.employees} status={ps} />
                </div>
              </Section>
              <Section title="Products & services">
                <BarList
                  format={money}
                  items={data.products.filter((p) => p.vertical === id && st.products[p.id]?.active).sort((x, y) => st.products[y.id].revenue - st.products[x.id].revenue).map((p) => ({
                    id: p.id, label: p.name, value: st.products[p.id].revenue, color: colors[id].base,
                    sub: `${pct(st.products[p.id].growth, { sign: true })} growth · ${pct(p.margin)} GM${p.recurring ? ' · recurring' : ''}`, onClick: () => s.select(p.id),
                  }))}
                />
              </Section>
            </>
          );
        })()}

        {vs && tab === 'growth' && (() => {
          const v = vs.v;
          const next = computeState(data, st.year + 1, s.scenario!, s.baseline!).verticals.find((x) => x.id === id);
          return (
            <>
              <Section title="Growth">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Metric label="Current growth" value={pct(vs.growth, { sign: true, digits: 1 })} status={ps} metric="growth" />
                  <Metric label={`Projected ${st.year + 1}`} value={next ? pct(next.growth, { sign: true, digits: 1 }) : '—'} status="projected" metric="revenue" sub={next ? money(next.revenue) : undefined} />
                  <Metric label="TAM" value={money(v.tam)} status={fieldStatus('tam', ctx, v.status)} metric="tam" />
                  <Metric label="SAM" value={money(v.sam)} status={fieldStatus('sam', ctx, v.status)} metric="sam" />
                  <Metric label="Market penetration" value={pct(vs.revenue / v.sam, { digits: 2 })} status="estimated" metric="penetration" />
                  <Metric label="Expansion potential" value={`${v.growthPotential}/10`} status="estimated" />
                  <Metric label="Required investment" value={money(v.requiredInvestment)} status="estimated" />
                  <Metric label="Lead flow" value={`${num(v.ops.leadsPerMonth)}/mo`} status={ps} sub={`needs ${num(v.ops.leadsNeeded)}/mo`} />
                </div>
              </Section>
              <Section title="Bottlenecks">
                {bns.length ? bns.map((b) => (
                  <div key={b.id} className="mb-2.5 last:mb-0">
                    <div className="flex items-center justify-between gap-2"><span className="text-[12px] text-fg">{b.title}</span><SeverityTag severity={b.severity} /></div>
                    <p className="mt-0.5 text-[11px] text-muted">{b.detail}</p>
                    <p className="mt-0.5 text-[11px] text-fg-2">→ {b.fix}</p>
                  </div>
                )) : <p className="text-[12px] text-muted">No bottlenecks detected.</p>}
              </Section>
              {v.expansion?.length ? (
                <Section title="Expansion markets">
                  {v.expansion.map((m) => (
                    <div key={m.market} className="flex justify-between py-0.5 text-[12px]"><span className="text-fg-2">{m.market}</span><span className="num text-fg">{money(vs.revenue * m.sizeRatio * m.capture)} <StatusBadge status="estimated" /></span></div>
                  ))}
                </Section>
              ) : null}
            </>
          );
        })()}

        {vs && tab === 'strategic' && (() => {
          const syn = a.synergies.filter((x) => x.a === id || x.b === id);
          const deps = data.infra.filter((i) => i.dependents.includes(id));
          const fns = data.functions.filter((f) => f.serves.includes(id));
          const pairDeps = data.pairs.filter((p) => p.dependency && (p.dependency.from === id || p.dependency.to === id));
          const bundles = a.bundles.filter((b) => b.verticals.includes(id));
          const ups = a.opportunities.filter((o) => o.type === 'upsell' && o.nodeIds.some((n) => data.products.find((p) => p.id === n)?.vertical === id));
          return (
            <>
              <Section title="Position">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Metric label="Strategic importance" value={`${vs.v.strategicImportance}/10`} status="estimated" />
                  <Metric label="Share of group revenue" value={pct(vs.revenue / st.revenue)} status={ps} />
                </div>
              </Section>
              <Section title="Cross-sell & shared customers">
                {syn.map((x) => {
                  const other = x.a === id ? x.b : x.a;
                  return (
                    <button key={x.id} onClick={() => s.select(other)} className="mb-2 block w-full text-left last:mb-0">
                      <div className="flex items-center justify-between text-[12px]"><span className="text-fg-2">↔ {vName(other)}</span><span className="num text-fg">{x.score}<span className="text-muted">/100</span></span></div>
                      <div className="text-[11px] text-muted">{x.pair.sharedCustomers} shared customers · {money(x.incrementalRevenue)} upside · {money(x.costSavings)} savings <StatusBadge status="estimated" /></div>
                    </button>
                  );
                })}
              </Section>
              {ups.length > 0 && <Section title="Upsell"><BarList format={money} items={ups.map((o) => ({ id: o.id, label: o.name.replace('Upsell ', ''), value: o.revenue, color: 'var(--pos)' }))} /></Section>}
              {bundles.length > 0 && (
                <Section title="Integration opportunities">
                  {bundles.map((b) => <div key={b.id} className="mb-1.5 text-[12px]"><span className="text-fg">{b.name}</span> <span className="text-muted">— {b.members.map((m) => m.name).join(' + ')}</span> <span className="num text-pos">+{money(b.incrementalRevenue)}</span></div>)}
                </Section>
              )}
              <Section title="Dependencies & shared resources">
                {deps.map((i) => <button key={i.id} onClick={() => s.select(i.id)} className="flex w-full justify-between py-0.5 text-left text-[12px]"><span className="text-fg-2">◆ {i.name}</span><span className="text-[11px] text-muted">debt {pct(i.techDebt)} · shared by {i.dependents.length}</span></button>)}
                {fns.map((f) => <button key={f.id} onClick={() => s.select(f.id)} className="flex w-full justify-between py-0.5 text-left text-[12px]"><span className="text-fg-2">▢ {f.name}</span><span className="text-[11px] text-muted">{f.fte} FTE · {pct(f.utilization)}</span></button>)}
                {pairDeps.map((p) => <div key={p.a + p.b} className="py-0.5 text-[12px] text-fg-2">→ {p.dependency!.note}</div>)}
              </Section>
              <Section title="Risks">
                <ul className="space-y-1">{vs.v.risks.map((r) => <li key={r} className="text-[12px] text-fg-2">· {r}</li>)}</ul>
              </Section>
            </>
          );
        })()}

        {/* ── Product ── */}
        {prod && tab !== 'scaling' && (
          <>
            <Section title="Product">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Metric label="Revenue" value={money(prod.revenue)} status={ps} metric="revenue" />
                <Metric label="Growth" value={pct(prod.growth, { sign: true, digits: 1 })} status={ps} metric="growth" />
                <Metric label="Avg transaction" value={money(prod.p.atv)} status="actual" />
                <Metric label="Gross margin" value={pct(prod.p.margin)} status="actual" metric="grossMargin" />
                <Metric label="Customers" value={num(prod.customers)} status={ps} />
                <Metric label="Repeat purchase" value={pct(prod.p.repeatRate)} status="actual" />
                <Metric label="Attach rate" value={pct(prod.p.attachRate)} status="actual" sub={`of ${vName(prod.p.vertical)} customers`} />
                <Metric label="Revenue type" value={prod.p.recurring ? 'Recurring' : 'One-time'} status="actual" />
              </div>
            </Section>
            <Section title="Related products">
              {a.offerPairs.filter((o) => o.a.id === id || o.b.id === id).map((o) => {
                const other = o.a.id === id ? o.b : o.a;
                return (
                  <button key={o.id} onClick={() => s.select(other.id)} className="mb-1.5 block w-full text-left">
                    <div className="flex justify-between text-[12px]"><span className="text-fg-2">{other.name} <span className="text-muted">· {vName(other.vertical)}</span></span><span className="num text-pos">+{money(o.incrementalRevenue)}</span></div>
                    <div className="text-[11px] text-muted">{o.currentBoth} buy both · {pct(o.penetration)} penetration · affinity {pct(o.affinity)} <StatusBadge status="estimated" /></div>
                  </button>
                );
              })}
            </Section>
            {prod.p.upsell && <Section title="Upsell path"><div className="text-[12px] text-fg-2">→ {prod.p.upsell.to}: {pct(prod.p.upsell.rate)} adoption × {money(prod.p.upsell.priceUplift)}/yr = <span className="num text-pos">{money(prod.customers * prod.p.upsell.rate * prod.p.upsell.priceUplift)}</span> <StatusBadge status="estimated" /></div></Section>}
          </>
        )}

        {/* ── Segment ── */}
        {seg && tab !== 'scaling' && (
          <>
            <Section title="Segment">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Metric label="Customers" value={num(seg.customers)} status={ps} />
                <Metric label="Revenue" value={money(seg.revenue)} status={ps} metric="revenue" sub={`${pct(seg.share)} of group`} />
                <Metric label="Avg customer value" value={money(seg.revenue / Math.max(1, seg.customers))} status={ps} metric="revenuePerCustomer" />
                <Metric label="Retention" value={pct(seg.s.retention)} status="actual" metric="retention" />
                <Metric label="Verticals bought from" value={`${seg.verticals.length}/${st.active.length}`} status={ps} />
                <Metric label="Cross-sell potential" value={pct(seg.s.crossSellPotential)} status="estimated" metric="crossSell" />
              </div>
            </Section>
            <Section title="Products purchased">
              <BarList format={money} items={seg.s.purchases.filter((p) => st.products[p.product]?.active).sort((x, y) => y.revenue - x.revenue).map((p) => ({ id: p.product, label: st.products[p.product].p.name, value: p.revenue, color: colors[st.products[p.product].p.vertical]?.base, onClick: () => s.select(p.product) }))} />
            </Section>
            <Section title="Not yet buying from">
              <div className="flex flex-wrap gap-1.5">{st.active.filter((v) => !seg.verticals.includes(v.id) && !v.isNew).map((v) => <button key={v.id} onClick={() => s.select(v.id)} className="border border-line px-1.5 py-0.5 text-[11px] text-fg-2 hover:border-line-2">{v.v.name}</button>)}</div>
            </Section>
          </>
        )}

        {/* ── Infrastructure / shared team ── */}
        {(infra || fn) && tab !== 'scaling' && (
          <>
            <Section title={infra ? 'Infrastructure' : 'Shared team'}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Metric label="Annual cost" value={money(infra?.annualCost ?? fn!.annualCost)} status="actual" />
                {infra && <Metric label="Tech debt" value={pct(infra.techDebt)} status="estimated" />}
                {fn && <Metric label="FTE" value={fn.fte} status="actual" />}
                {fn && <Metric label="Utilization" value={pct(fn.utilization)} status="actual" />}
                <Metric label="Dependent verticals" value={(infra?.dependents ?? fn!.serves).length} status="actual" />
                <Metric label="Cost per dependent" value={money((infra?.annualCost ?? fn!.annualCost) / Math.max(1, (infra?.dependents ?? fn!.serves).length))} status="actual" />
              </div>
            </Section>
            <Section title="Who depends on it">
              <BarList format={money} items={(infra?.dependents ?? fn!.serves).filter((d) => st.verticals.find((v) => v.id === d)?.active).map((d) => ({ id: d, label: vName(d), value: st.verticals.find((v) => v.id === d)!.revenue, color: colors[d]?.base, sub: 'revenue exposed', onClick: () => s.select(d) }))} />
              <p className="mt-2 text-[11px] text-muted">An outage here puts {money(sum((infra?.dependents ?? fn!.serves).map((d) => st.verticals.find((v) => v.id === d)?.revenue ?? 0)))} of revenue at risk.</p>
            </Section>
            {infra?.externalizable && (
              <Section title="Monetization">
                <div className="text-[12px] text-fg-2">Sell as “{infra.externalizable.offer}”: {infra.externalizable.customers} customers × {money(infra.externalizable.price)} = <span className="num text-pos">{money(infra.externalizable.customers * infra.externalizable.price)}</span> <StatusBadge status="estimated" /></div>
              </Section>
            )}
            {bns.length > 0 && <Section title="Bottlenecks">{bns.map((b) => <div key={b.id} className="mb-1.5"><div className="flex justify-between gap-2 text-[12px] text-fg"><span>{b.title}</span><SeverityTag severity={b.severity} /></div><p className="text-[11px] text-muted">{b.fix}</p></div>)}</Section>}
          </>
        )}

        {/* ── Non-vertical growth/strategic placeholders ── */}
        {isParent && (tab === 'growth' || tab === 'strategic') && (
          <Section title={tab === 'growth' ? 'Where growth comes from' : 'Strongest relationships'}>
            {tab === 'growth'
              ? <BarList format={(v) => pct(v, { sign: true })} items={[...st.active].filter((v) => v.prevRevenue).sort((x, y) => y.growth - x.growth).map((v) => ({ id: v.id, label: v.v.name, value: v.growth, color: colors[v.id]?.base, onClick: () => s.select(v.id) }))} />
              : a.synergies.slice(0, 6).map((x) => <div key={x.id} className="flex justify-between py-0.5 text-[12px]"><span className="text-fg-2">{vName(x.a)} ↔ {vName(x.b)}</span><span className="num text-fg">{x.score}</span></div>)}
          </Section>
        )}

        {/* ── Scaling: current vs potential ── */}
        {tab === 'scaling' && pot && (
          <>
            <Section title="Current vs potential">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Metric label="Current revenue" value={money(pot.current)} status={ps} metric="revenue" size="lg" />
                <Metric label="Potential revenue" value={money(pot.potential)} status="estimated" metric="potential" size="lg" sub={`${pct(pot.potential / Math.max(1, pot.current) - 1, { sign: true })}`} />
                <Metric label="Risk-adjusted" value={money(pot.riskAdjusted)} status="estimated" metric="potential" sub="each driver × its confidence" />
              </div>
            </Section>
            <Section title="What produces the potential">
              {pot.drivers.length ? pot.drivers.map((d) => (
                <div key={d.label} className="mb-2 last:mb-0">
                  <div className="flex items-baseline justify-between gap-2 text-[12px]"><span className="text-fg-2">{d.label}</span><span className="num shrink-0 text-pos">+{money(d.amount)}</span></div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted"><StatusBadge status={d.kind === 'organic' ? 'projected' : 'estimated'} />confidence {pct(d.confidence)}</div>
                </div>
              )) : <p className="text-[12px] text-muted">No identified drivers for this node.</p>}
            </Section>
            {history.length > 0 && (
              <Section title="Revenue over time">
                <YearColumns rows={history} format={money} highlight={s.year} />
                <p className="mt-2 text-[10px] text-muted">Hatched = projected. Dashed outline = baseline when a scenario is active.</p>
              </Section>
            )}
          </>
        )}
        {tab === 'scaling' && !pot && <Section title="Scaling"><p className="text-[12px] text-muted">Scaling analysis applies to revenue-generating nodes.</p></Section>}
        {id === 'acquisition' && <Section title="Acquisition"><button onClick={() => s.setView('opportunities')} className="flex items-center gap-1 text-[12px] text-accent">Open the acquisition simulator <ArrowRight className="size-3" /></button></Section>}
      </div>
    </aside>
  );
}
