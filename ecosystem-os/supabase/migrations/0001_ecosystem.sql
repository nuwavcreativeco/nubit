-- Ecosystem OS storage. Company snapshots are stored as validated JSON documents (the
-- CompanySchema contract) so connectors can evolve the model without schema migrations.
-- Accessed server-side with the service-role key; RLS is on with no public policies.

create table if not exists public.companies (
  id text primary key,
  name text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  params jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists scenarios_company_idx on public.scenarios (company_id, created_at desc);

create table if not exists public.acquisitions (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  input jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists acquisitions_company_idx on public.acquisitions (company_id, created_at desc);

alter table public.companies enable row level security;
alter table public.scenarios enable row level security;
alter table public.acquisitions enable row level security;
