-- A reel is the unit of work on a profile. The profile grid is a grid of
-- these, and posting a day picks one rather than pasting a URL, so the same
-- piece of work can front several days without being re-uploaded.
create table if not exists reels (
  id               uuid        primary key default gen_random_uuid(),
  owner_id         uuid        not null references profiles(id) on delete cascade,
  video_url        text        not null,
  poster_url       text,
  caption          text,
  -- The two shapes nubid.co filters the board by.
  aspect           text        not null default '16:9'
                     check (aspect in ('16:9', '9:16')),
  duration_seconds int         check (duration_seconds is null or duration_seconds > 0),
  created_at       timestamptz not null default now()
);

create index if not exists reels_by_owner
  on reels (owner_id, created_at desc);

alter table reels enable row level security;

create policy "reels are public" on reels
  for select using (true);

create policy "own your reels" on reels
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "edit your reels" on reels
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "delete your reels" on reels
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- A day fronts one reel. on delete set null so removing a reel never takes a
-- live auction down with it.
alter table slots
  add column if not exists reel_id uuid references reels(id) on delete set null;

create index if not exists slots_reel_id_idx on slots (reel_id);

-- The grid is reels now, not days. Public: it is a portfolio.
drop function if exists profile_grid(text,int,int);

create or replace function profile_grid(
  p_handle text,
  p_limit  int default 30,
  p_offset int default 0
)
returns table (
  id               uuid,
  video_url        text,
  poster_url       text,
  caption          text,
  aspect           text,
  duration_seconds int,
  created_at       timestamptz,
  live_slot_id     uuid,
  live_closes_at   timestamptz,
  live_cents       int
)
language sql
stable
set search_path = public
as $$
  select
    r.id, r.video_url, r.poster_url, r.caption, r.aspect,
    r.duration_seconds, r.created_at,
    s.id, s.closes_at, coalesce(s.current_cents, s.floor_rate_cents)
  from reels r
  join profiles p on p.id = r.owner_id
  -- at most one open day per reel decorates the tile with a live price
  left join lateral (
    select s.id, s.closes_at, s.current_cents, s.floor_rate_cents
    from slots s
    where s.reel_id = r.id
      and s.status = 'open'
      and s.closes_at > now()
    order by s.closes_at
    limit 1
  ) s on true
  where p.handle = lower(p_handle)
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 60)
  offset greatest(p_offset, 0);
$$;

revoke all on function profile_grid(text,int,int) from public;
grant execute on function profile_grid(text,int,int) to authenticated, anon;

-- What the post-a-day form offers in its reel picker.
create or replace function my_reels()
returns table (
  id               uuid,
  video_url        text,
  poster_url       text,
  caption          text,
  aspect           text,
  duration_seconds int,
  created_at       timestamptz
)
language sql
stable
set search_path = public
as $$
  select r.id, r.video_url, r.poster_url, r.caption, r.aspect,
         r.duration_seconds, r.created_at
  from reels r
  where r.owner_id = (select auth.uid())
  order by r.created_at desc;
$$;

revoke all on function my_reels() from public;
grant execute on function my_reels() to authenticated;
