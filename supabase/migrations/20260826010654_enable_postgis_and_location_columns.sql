create extension if not exists postgis with schema extensions;

-- Precise coordinates live in their own table so the privacy split is
-- structural rather than a column grant somebody forgets to maintain.
-- Nothing here is readable by anon, ever.
create table if not exists public.slot_locations (
  slot_id    uuid primary key references public.slots(id) on delete cascade,
  geog       extensions.geography(Point, 4326) not null,
  address    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.slot_locations enable row level security;

-- The videographer always; the winner only once there is a deal.
create policy "exact location for the parties involved" on public.slot_locations
  for select to authenticated
  using (
    exists (
      select 1 from public.slots s
      where s.id = slot_locations.slot_id
        and (
          s.videographer_id = (select auth.uid())
          or (s.winner_id = (select auth.uid())
              and s.status = any (array['won','claimed']))
        )
    )
  );

revoke all on public.slot_locations from anon, authenticated;
grant select on public.slot_locations to authenticated;

-- Public, deliberately coarse. Rounded to 2dp is roughly a kilometre, which
-- is meaningless for "who is nearest" and useless for finding someone's house.
alter table public.slots
  add column if not exists geog_approx extensions.geography(Point, 4326),
  add column if not exists area_label  text;

alter table public.profiles
  add column if not exists geog_approx extensions.geography(Point, 4326);

create index if not exists slots_geog_open_idx
  on public.slots using gist (geog_approx)
  where status = 'open';

create index if not exists profiles_geog_idx
  on public.profiles using gist (geog_approx);
