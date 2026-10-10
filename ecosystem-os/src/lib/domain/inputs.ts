import type { CompanyData, DataStatus, FieldStatus } from './types';
import { fieldStatus } from './provenance';

/**
 * The figures an owner can type in to replace estimates. Each field knows where it lives in
 * CompanyData, how to show it, and which status key marks it ACT once the owner confirms it.
 */
export type InputFormat = 'money' | 'pct' | 'count' | 'decimal';

export interface InputField {
  id: string; // unique across the company, e.g. "product:mu-recording:customers"
  group: string; // section heading (unit name)
  label: string;
  help?: string;
  format: InputFormat;
  value: number;
  status: DataStatus;
  /** Biggest effect on the analysis; shown under "Start here" while still estimated. */
  priority?: boolean;
}

type Entity = { status?: FieldStatus };
interface Def<E extends Entity> {
  key: string;
  label: string;
  format: InputFormat;
  help?: string;
  priority?: boolean;
  get: (e: E, year: number) => number;
  set: (e: E, v: number, year: number) => void;
}

const plain = <E extends Entity>(key: keyof E & string, label: string, format: InputFormat, extra: Partial<Def<E>> = {}): Def<E> => ({
  key, label, format, ...extra,
  get: (e) => Number(e[key] ?? 0),
  set: (e, v) => { (e as Record<string, unknown>)[key] = v; },
});
const revenueThisYear = <E extends Entity & { revenue: Record<string, number> }>(help: string): Def<E> => ({
  key: 'revenue', label: 'Revenue this year', format: 'money', help,
  get: (e, y) => e.revenue[y] ?? 0,
  set: (e, v, y) => { e.revenue[y] = v; },
});

type Parent = CompanyData['parent'];
type Vertical = CompanyData['verticals'][number];
type Product = CompanyData['products'][number];
type Infra = CompanyData['infra'][number];
type Fn = CompanyData['functions'][number];

const PARENT: Def<Parent>[] = [
  plain<Parent>('cash', 'Cash on hand', 'money', { priority: true, help: 'Across all business accounts today.' }),
  plain<Parent>('monthlyOpex', 'Monthly operating costs', 'money', { priority: true, help: 'Studio, software (GoHighLevel etc.), contractors, ads — everything except cost of goods.' }),
  plain<Parent>('debt', 'Debt outstanding', 'money'),
  plain<Parent>('topCustomerShare', 'Largest customer, share of total revenue', 'pct'),
];

const ops = (key: 'leadsPerMonth' | 'leadsNeeded' | 'utilization' | 'topCustomerShare', label: string, format: InputFormat, extra: Partial<Def<Vertical>> = {}): Def<Vertical> => ({
  key, label, format, ...extra,
  get: (v) => v.ops[key],
  set: (v, x) => { v.ops[key] = x; },
});

const VERTICAL: Def<Vertical>[] = [
  revenueThisYear<Vertical>('Total for the current year (expected, if the year is not over).'),
  plain<Vertical>('customers', 'Customers per year', 'count'),
  plain<Vertical>('employees', 'Employees (excluding you)', 'decimal'),
  ops('leadsPerMonth', 'Leads per month today', 'count', { priority: true }),
  ops('leadsNeeded', 'Leads per month needed for the target', 'count', { priority: true }),
  ops('utilization', 'Delivery capacity in use', 'pct', { priority: true, help: 'How full the calendar is: 100% means you could not take one more job.' }),
  ops('topCustomerShare', 'Largest customer, share of this unit', 'pct'),
  plain<Vertical>('grossMargin', 'Gross margin', 'pct'),
  plain<Vertical>('ebitdaMargin', 'Profit margin (EBITDA)', 'pct'),
  plain<Vertical>('retention', 'Customers who come back / stay', 'pct'),
  plain<Vertical>('cac', 'Cost to win a customer (CAC)', 'money'),
  plain<Vertical>('ltv', 'Lifetime value of a customer', 'money'),
  plain<Vertical>('marketingSpend', 'Marketing spend per year', 'money'),
  plain<Vertical>('sam', 'Market you can realistically serve (SAM)', 'money'),
  plain<Vertical>('tam', 'Total market (TAM)', 'money'),
];

const PRODUCT: Def<Product>[] = [
  plain<Product>('customers', 'Paying customers per year', 'count', { priority: true }),
  revenueThisYear<Product>('Sets this service’s share of its unit’s revenue.'),
  plain<Product>('atv', 'Average price per sale', 'money'),
  plain<Product>('margin', 'Gross margin', 'pct'),
  plain<Product>('repeatRate', 'Buyers who purchase again', 'pct'),
];

const INFRA: Def<Infra>[] = [plain<Infra>('annualCost', 'Annual cost', 'money')];
const FUNCTION: Def<Fn>[] = [
  plain<Fn>('annualCost', 'Annual cost', 'money'),
  plain<Fn>('fte', 'Full-time equivalents', 'decimal'),
  plain<Fn>('utilization', 'Time in use', 'pct', { priority: true }),
];

const NO_CTX = { isProjected: false, scenarioActive: false };

/** Every editable field, with its current value and status. */
export function inputFields(data: CompanyData): InputField[] {
  const y = data.parent.currentYear;
  const out: InputField[] = [];
  const add = <E extends Entity>(kind: string, id: string, group: string, e: E, defs: Def<E>[]) => {
    for (const d of defs) {
      out.push({
        id: `${kind}:${id}:${d.key}`, group, label: d.label, help: d.help, format: d.format, priority: d.priority,
        value: d.get(e, y), status: fieldStatus(d.key, NO_CTX, e.status),
      });
    }
  };
  add('parent', 'parent', `${data.parent.name} (company)`, data.parent, PARENT);
  for (const v of data.verticals) {
    add('vertical', v.id, v.name, v, VERTICAL);
    for (const p of data.products.filter((p) => p.vertical === v.id)) add('product', p.id, `${v.name} · ${p.name}`, p, PRODUCT);
  }
  for (const i of data.infra) add('infra', i.id, `Systems · ${i.name}`, i, INFRA);
  for (const f of data.functions) add('function', f.id, `People · ${f.name}`, f, FUNCTION);
  return out;
}

/**
 * Apply owner-entered values (or plain confirmations) and mark each field ACT.
 * Working-capital months follow cash ÷ monthly costs unless the owner set them directly.
 */
export function applyInputs(data: CompanyData, edits: Record<string, number | 'confirm'>, today: string): CompanyData {
  const next: CompanyData = structuredClone(data);
  const y = next.parent.currentYear;
  const apply = <E extends Entity>(e: E, defs: Def<E>[], prefix: string) => {
    for (const d of defs) {
      const edit = edits[`${prefix}:${d.key}`];
      if (edit === undefined) continue;
      if (edit !== 'confirm') d.set(e, edit, y);
      e.status = { ...e.status, [d.key]: 'actual' };
    }
  };
  apply(next.parent, PARENT, 'parent:parent');
  for (const v of next.verticals) apply(v, VERTICAL, `vertical:${v.id}`);
  for (const p of next.products) apply(p, PRODUCT, `product:${p.id}`);
  for (const i of next.infra) apply(i, INFRA, `infra:${i.id}`);
  for (const f of next.functions) apply(f, FUNCTION, `function:${f.id}`);

  const p = next.parent;
  if ((edits['parent:parent:cash'] !== undefined || edits['parent:parent:monthlyOpex'] !== undefined) && p.monthlyOpex > 0) {
    p.workingCapitalMonths = Math.round((p.cash / p.monthlyOpex) * 10) / 10;
    if (p.status?.cash === 'actual' && p.status?.monthlyOpex === 'actual') p.status = { ...p.status, workingCapitalMonths: 'actual' };
  }
  next.meta = { ...next.meta, asOf: today };
  return next;
}
