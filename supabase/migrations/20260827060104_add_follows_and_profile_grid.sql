-- Following a videographer is the spine of the whole thing: it decides who
-- gets the bell when a day is posted, and it sorts the inbox.
create table if not exists follows (
  follower_id uuid        not null references profiles(id) on delete cascade,
  followee_id uuid        not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_no_self check (follower_id <> followee_id)
);

-- The PK covers "who do I follow"; this covers "who follows them" and the
-- follower-count scan.
create index if not exists follows_followee_idx
  on follows (followee_id, created_at desc);

alter table follows enable row level security;

-- Counts are public, so the read policy is too. Writes are your own row only.
create policy "follows are public" on follows
  for select using (true);

create policy "follow as yourself" on follows
  for insert to authenticated
  with check (follower_id = (select auth.uid()));

create policy "unfollow yourself" on follows
  for delete to authenticated
  using (follower_id = (select auth.uid()));

revoke update on follows from authenticated, anon;

-- Follower / following tallies, plus whether the caller follows this person,
-- so the follow button can render in one round trip.
create or replace view follow_counts
with (security_invoker = on) as
select
  p.id,
  (select count(*) from follows f where f.followee_id = p.id) as followers,
  (select count(*) from follows f where f.follower_id = p.id) as following
from profiles p;

grant select on follow_counts to authenticated, anon;

create or replace function is_following(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from follows
    where follower_id = (select auth.uid()) and followee_id = p_user
  );
$$;

revoke all on function is_following(uuid) from public;
grant execute on function is_following(uuid) to authenticated;

-- The profile grid: a videographer's body of work, newest first. Public, and
-- deliberately not filtered to open slots -- the grid is a portfolio, not a
-- feed, so settled and expired days still count as work shown.
create or replace function profile_grid(
  p_handle text,
  p_limit  int default 30,
  p_offset int default 0
)
returns table (
  id               uuid,
  title            text,
  shoot_date       date,
  area_label       text,
  reel_url         text,
  poster_url       text,
  status           text,
  floor_rate_cents int,
  current_cents    int,
  settled_cents    int,
  closes_at        timestamptz,
  bid_count        int
)
language sql
stable
set search_path = public
as $$
  select
    s.id, s.title, s.shoot_date, s.area_label,
    s.reel_url, s.poster_url, s.status,
    s.floor_rate_cents, s.current_cents, s.settled_cents,
    s.closes_at, s.bid_count
  from slots s
  join profiles p on p.id = s.videographer_id
  where p.handle = lower(p_handle)
    and s.status <> 'draft'
  order by s.shoot_date desc, s.created_at desc
  limit least(greatest(p_limit, 1), 60)
  offset greatest(p_offset, 0);
$$;

revoke all on function profile_grid(text,int,int) from public;
grant execute on function profile_grid(text,int,int) to authenticated, anon;
