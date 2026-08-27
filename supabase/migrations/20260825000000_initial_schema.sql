-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Sets up the three core Nubid tables and baseline row-level security.

-- One row per signed-up user, extending Supabase's built-in auth.users.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('videographer', 'bidder')),
  display_name text not null,
  city text,
  created_at timestamptz not null default now()
);

-- An open shoot slot posted by a videographer.
create table if not exists slots (
  id uuid primary key default gen_random_uuid(),
  videographer_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  shoot_date date not null,
  location text not null,
  floor_rate_cents integer not null check (floor_rate_cents > 0),
  description text,
  status text not null default 'open' check (status in ('open', 'awarded', 'cancelled')),
  awarded_bid_id uuid,
  created_at timestamptz not null default now()
);

-- A bid placed on a slot by a bidder (must be above the floor rate).
create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references slots (id) on delete cascade,
  bidder_id uuid not null references profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

alter table slots
  add constraint slots_awarded_bid_id_fkey
  foreign key (awarded_bid_id) references bids (id) on delete set null;

-- Covering indexes for the foreign keys above (Postgres doesn't add these
-- automatically, and every one of them is walked on every slot/bid page).
create index if not exists slots_videographer_id_idx on slots (videographer_id);
create index if not exists slots_awarded_bid_id_idx on slots (awarded_bid_id);
create index if not exists bids_slot_id_idx on bids (slot_id);
create index if not exists bids_bidder_id_idx on bids (bidder_id);

-- Row-level security: everyone can read; writes are scoped to the owner.
-- auth.uid() is wrapped in `(select ...)` so Postgres evaluates it once per
-- query instead of once per row (see Supabase's RLS performance guidance).
alter table profiles enable row level security;
alter table slots enable row level security;
alter table bids enable row level security;

create policy "profiles are publicly readable" on profiles
  for select using (true);

create policy "users insert their own profile" on profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "users update their own profile" on profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "slots are publicly readable" on slots
  for select using (true);

create policy "videographers create their own slots" on slots
  for insert to authenticated
  with check ((select auth.uid()) = videographer_id);

create policy "videographers update their own slots" on slots
  for update to authenticated
  using ((select auth.uid()) = videographer_id)
  with check ((select auth.uid()) = videographer_id);

create policy "bids are publicly readable" on bids
  for select using (true);

create policy "bidders create their own bids" on bids
  for insert to authenticated
  with check ((select auth.uid()) = bidder_id);

-- Stream bid/slot changes to the slot detail page in real time. Postgres
-- Changes only sends a row to a client if that client's existing SELECT
-- policies would let them read it — the "publicly readable" policies above
-- already cover that, so no separate realtime-specific policy is needed.
alter publication supabase_realtime add table bids, slots;

-- Auto-create a profile row when someone signs up via Supabase Auth.
-- Runs as SECURITY DEFINER because it fires before the new user has a
-- session (and thus no auth.uid() to satisfy the profiles RLS policy).
-- EXECUTE is revoked from anon/authenticated below so it's only reachable
-- as a trigger, not as a callable RPC endpoint.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name, city)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'bidder'),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'city'
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
