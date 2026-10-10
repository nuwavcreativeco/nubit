# Ecosystem OS — Parent Company Intelligence Graph

Models a multi-vertical parent company as a living graph — verticals, products, customer segments,
shared infrastructure and the relationships between them — and computes how the whole company
creates value together: revenue flows, synergies, cross-sell and bundle opportunities, bottlenecks,
health, valuation, what-if scenarios and acquisition fit. An AI analyst answers questions using
only the engine's numbers.

```bash
npm install
npm run dev        # http://localhost:3000
```

Two datasets ship built in (switch with the company selector):

- **Meridian Holdings** — 6 verticals + 1 planned (AI Labs, 2027), 23 products, 6 segments, 7 shared systems.
- **Atlas Group (scale test)** — ~1,000 nodes, to exercise clustering and level-of-detail rendering.

## Architecture

```
src/
  lib/domain/        Data model (types.ts), runtime contract (schema.ts, Zod → JSON Schema), provenance labels
  lib/data/          Repository interface + stores (file JSON default, Supabase/Postgres), seed datasets,
                     connectors (registry, CSV import), browser API client
  lib/analytics/     Pure calculation engine — no UI code:
                       model.ts          revenue/EBITDA/customers by year, scenario application, valuation
                       synergy.ts        10-factor synergy score per vertical pair
                       health.ts         11-component business health score with reasons
                       bottlenecks.ts    rule-based sales/ops/tech/customer/financial/personnel detection
                       overlap.ts        product-pair offer overlap + bundle detection (clique search)
                       opportunities.ts  9 opportunity generators, ranked by opportunity score
                       acquisition.ts    strategic fit, synergies, integration risk for a target
                       potential.ts      current vs potential revenue with drivers
                       whatif.ts         projections, remove-a-vertical, investment allocation
                       insights.ts       investor thesis + executive Q&A generated from data
                       explain.ts        formula registry behind every metric (click any number)
  lib/graph/         Graph engine: build.ts (nodes/edges per mode, metric, filters, clustering, aggregation),
                     layout.ts (deterministic radial layout), theme.ts (modes, edge styles, validated palette)
  lib/ai/            Analyst: tools.ts (engine functions exposed as tools), analyst.ts (Claude tool-use loop),
                     local.ts (deterministic fallback), prompt.ts
  lib/auth/          Optional password gate (signed cookie) — swap for Supabase Auth/SSO behind the same API
  lib/export/        CSV exports
  store/             Zustand view state + memoised analysis hooks
  components/        UI only — reads engine results, never computes business logic
  app/api/           Route handlers (companies, scenarios, acquisitions, analyst stream, schema, auth)
  app/report/        Print-ready investor and executive reports (browser → PDF)
supabase/migrations/ Postgres schema for the Supabase store
```

**Data flow:** connector → `CompanySchema` validation → repository → `analyze(data, year, scenario)` →
graph builder / dashboards / AI tools. Everything downstream of the schema is source-agnostic, so live
integrations (Stripe, Shopify, HubSpot, Salesforce, QuickBooks, GA4, ad platforms) only need to emit a
valid `CompanyData` document. The integration registry in Settings lists what each would fill.

## Data confidence

Every number carries a label: **Actual**, **Estimated**, **Projected**, **AI generated** or **User input**.
Past and current periods are actual; future years and anything under a scenario are projected; model
outputs (synergy, opportunities, health, valuation) and inherently assumed inputs (TAM, LTV, affinity)
are estimated. Per-field overrides go in an entity's `status` map. Click any metric for its formula.

## AI analyst

With `ANTHROPIC_API_KEY` set, questions go to Claude (`claude-opus-5-5`, adaptive thinking, medium effort,
server-side refusal fallback) with 15 tools that run the analytics engine. The system prompt forbids
stating figures that didn't come from a tool result and requires a provenance tag after each one.
Without a key, a deterministic analyst routes questions to the same tools and templates the answer.

## Configuration

See `.env.example`. All optional: `ANTHROPIC_API_KEY` (Claude analyst), `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` (Postgres storage — apply the migration first), `APP_PASSWORD` + `AUTH_SECRET`
(password gate).
