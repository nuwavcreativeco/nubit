-- nubid.co's board card carries more than a title and a price: the reel it
-- is fronted with, who is shooting it, and their rating. The two ways of
-- reading the board (everything open, and everything near you) now return
-- the SAME shape, so one card component renders both and the phone can use
-- the identical contract.
--
-- drop + create rather than replace, because the return type changes. Both
-- statements are in one transaction, so there is no window where the board
-- is missing.
drop function if exists slots_near(double precision,double precision,double precision,integer,integer);

create or replace function slots_board(p_limit int default 60, p_offset int default 0)
returns table (
  id                uuid,
  title             text,
  shoot_date        date,
  location          text,
  area_label        text,
  floor_rate_cents  int,
  current_cents     int,
  claim_cents       int,
  closes_at         timestamptz,
  bid_count         int,
  video_url         text,
  poster_url        text,
  aspect            text,
  duration_seconds  int,
  videographer_id   uuid,
  videographer_name text,
  handle            text,
  avatar_url        text,
  rating            numeric,
  distance_mi       double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id, s.title, s.shoot_date, s.location, s.area_label,
    s.floor_rate_cents, s.current_cents, s.claim_cents,
    s.closes_at, s.bid_count,
    coalesce(r.video_url,  s.reel_url),
    coalesce(r.poster_url, s.poster_url),
    coalesce(r.aspect, '16:9'),
    r.duration_seconds,
    s.videographer_id, p.display_name, p.handle, p.avatar_url,
    vs.rating,
    null::double precision
  from slots s
  join profiles p on p.id = s.videographer_id
  left join reels r on r.id = s.reel_id
  left join videographer_stats vs on vs.id = s.videographer_id
  where s.status = 'open'
    and s.closes_at > now()
  order by s.closes_at
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

grant execute on function slots_board(int,int) to anon, authenticated;

-- SECURITY INVOKER on purpose, as before: RLS still applies, so drafts stay
-- hidden and this cannot become a way to enumerate unpublished slots.
-- Returns a distance, never a coordinate.
create or replace function slots_near(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_mi double precision default 50,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  id                uuid,
  title             text,
  shoot_date        date,
  location          text,
  area_label        text,
  floor_rate_cents  int,
  current_cents     int,
  claim_cents       int,
  closes_at         timestamptz,
  bid_count         int,
  video_url         text,
  poster_url        text,
  aspect            text,
  duration_seconds  int,
  videographer_id   uuid,
  videographer_name text,
  handle            text,
  avatar_url        text,
  rating            numeric,
  distance_mi       double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id, s.title, s.shoot_date, s.location, s.area_label,
    s.floor_rate_cents, s.current_cents, s.claim_cents,
    s.closes_at, s.bid_count,
    coalesce(r.video_url,  s.reel_url),
    coalesce(r.poster_url, s.poster_url),
    coalesce(r.aspect, '16:9'),
    r.duration_seconds,
    s.videographer_id, p.display_name, p.handle, p.avatar_url,
    vs.rating,
    round((extensions.ST_Distance(s.geog_approx, public.fuzz_point(p_lat, p_lng))
           / 1609.344)::numeric, 1)::double precision
  from slots s
  join profiles p on p.id = s.videographer_id
  left join reels r on r.id = s.reel_id
  left join videographer_stats vs on vs.id = s.videographer_id
  where s.status = 'open'
    and s.closes_at > now()
    and s.geog_approx is not null
    and extensions.ST_DWithin(
          s.geog_approx,
          public.fuzz_point(p_lat, p_lng),
          least(greatest(p_radius_mi, 1), 500) * 1609.344
        )
  order by s.geog_approx operator(extensions.<->) public.fuzz_point(p_lat, p_lng),
           s.closes_at
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

grant execute on function slots_near(double precision,double precision,double precision,integer,integer)
  to anon, authenticated;
