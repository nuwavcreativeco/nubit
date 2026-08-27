-- One grid function serves both sides of the market.
--
--   a shooter's grid  = the reels they own
--   a creator's grid  = the reels fronting days they booked, credited back
--                       to the shooter who actually shot them
--
-- A creator uploads nothing to get a portfolio; winning a day earns them the
-- tile. 'both' accounts naturally show each set.
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
  source           text,
  credit_name      text,
  credit_handle    text,
  live_slot_id     uuid,
  live_closes_at   timestamptz,
  live_cents       int
)
language sql
stable
set search_path = public
as $$
  with target as (
    select id from profiles where handle = lower(p_handle)
  ),
  tiles as (
    -- work they shot
    select
      r.id, r.video_url, r.poster_url, r.caption, r.aspect,
      r.duration_seconds, r.created_at,
      'own'::text  as source,
      null::text   as credit_name,
      null::text   as credit_handle
    from reels r
    where r.owner_id = (select id from target)

    union all

    -- work they commissioned
    select
      r.id, r.video_url, r.poster_url, r.caption, r.aspect,
      r.duration_seconds, coalesce(s.settled_at, s.closes_at),
      'booked'::text,
      p.display_name,
      p.handle
    from slots s
    join reels    r on r.id = s.reel_id
    join profiles p on p.id = s.videographer_id
    where s.winner_id = (select id from target)
      and s.status in ('won', 'claimed')
  )
  select
    t.id, t.video_url, t.poster_url, t.caption, t.aspect,
    t.duration_seconds, t.created_at, t.source,
    t.credit_name, t.credit_handle,
    live.id, live.closes_at, live.cents
  from tiles t
  left join lateral (
    select s.id, s.closes_at,
           coalesce(s.current_cents, s.floor_rate_cents) as cents
    from slots s
    where s.reel_id = t.id
      and s.status = 'open'
      and s.closes_at > now()
    order by s.closes_at
    limit 1
  ) live on t.source = 'own'
  order by t.created_at desc
  limit least(greatest(p_limit, 1), 60)
  offset greatest(p_offset, 0);
$$;

revoke all on function profile_grid(text,int,int) from public;
grant execute on function profile_grid(text,int,int) to authenticated, anon;

-- The home feed, identical for shooters and creators: work from the people
-- you follow. Shooters read it as a peer feed, creators as a shopping feed,
-- and both stay consistent with what the phone shows.
create or replace function reels_following(p_limit int default 30, p_offset int default 0)
returns table (
  id               uuid,
  video_url        text,
  poster_url       text,
  caption          text,
  aspect           text,
  duration_seconds int,
  created_at       timestamptz,
  owner_id         uuid,
  owner_name       text,
  owner_handle     text,
  owner_avatar_url text,
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
    p.id, p.display_name, p.handle, p.avatar_url,
    live.id, live.closes_at, live.cents
  from reels r
  join follows  f on f.followee_id = r.owner_id
                 and f.follower_id = (select auth.uid())
  join profiles p on p.id = r.owner_id
  left join lateral (
    select s.id, s.closes_at,
           coalesce(s.current_cents, s.floor_rate_cents) as cents
    from slots s
    where s.reel_id = r.id
      and s.status = 'open'
      and s.closes_at > now()
    order by s.closes_at
    limit 1
  ) live on true
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 60)
  offset greatest(p_offset, 0);
$$;

revoke all on function reels_following(int,int) from public, anon;
grant execute on function reels_following(int,int) to authenticated;
