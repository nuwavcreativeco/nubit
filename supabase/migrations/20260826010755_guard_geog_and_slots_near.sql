create or replace function public.guard_slot_writes()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status         := case when new.status = 'draft' then 'draft' else 'open' end;
    new.current_cents  := null;
    new.leader_id      := null;
    new.bid_count      := 0;
    new.settled_cents  := null;
    new.winner_id      := null;
    new.settled_at     := null;
    new.awarded_bid_id := null;
    new.cancelled_at   := null;
    new.cancelled_by   := null;
    new.cancelled_from := null;
    new.cancel_reason  := null;
    new.geog_approx    := null;

    if new.closes_at <= now() then
      raise exception 'closes_at must be in the future' using errcode = '22023';
    end if;

    return new;
  end if;

  if new.id <> old.id
     or new.videographer_id <> old.videographer_id
     or new.created_at      <> old.created_at
     or new.current_cents   is distinct from old.current_cents
     or new.leader_id       is distinct from old.leader_id
     or new.bid_count       <> old.bid_count
     or new.settled_cents   is distinct from old.settled_cents
     or new.winner_id       is distinct from old.winner_id
     or new.settled_at      is distinct from old.settled_at
     or new.awarded_bid_id  is distinct from old.awarded_bid_id
     or new.cancelled_at    is distinct from old.cancelled_at
     or new.cancelled_by    is distinct from old.cancelled_by
     or new.cancelled_from  is distinct from old.cancelled_from
     or new.cancel_reason   is distinct from old.cancel_reason
     or new.geog_approx     is distinct from old.geog_approx then
    raise exception 'auction state is managed by the platform' using errcode = '42501';
  end if;

  if old.status <> 'draft' then
    if new.floor_rate_cents <> old.floor_rate_cents
       or new.claim_cents <> old.claim_cents
       or new.step_cents  <> old.step_cents
       or new.closes_at   <> old.closes_at
       or new.shoot_date  <> old.shoot_date then
      raise exception 'pricing and timing are locked once a slot is live' using errcode = '42501';
    end if;
  end if;

  if new.status <> old.status then
    if not (old.status = 'draft' and new.status = 'open') then
      raise exception 'use cancel_slot() to cancel; other status changes are automatic'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

-- SECURITY INVOKER on purpose: RLS still applies, so drafts stay hidden and
-- this cannot become a way to enumerate unpublished slots. Returns a distance,
-- never a coordinate.
create or replace function public.slots_near(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_mi double precision default 50,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  id               uuid,
  title            text,
  shoot_date       date,
  location         text,
  area_label       text,
  floor_rate_cents integer,
  current_cents    integer,
  claim_cents      integer,
  closes_at        timestamptz,
  bid_count        integer,
  reel_url         text,
  poster_url       text,
  distance_mi      double precision
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    s.id, s.title, s.shoot_date, s.location, s.area_label,
    s.floor_rate_cents, s.current_cents, s.claim_cents,
    s.closes_at, s.bid_count, s.reel_url, s.poster_url,
    round((extensions.ST_Distance(s.geog_approx, public.fuzz_point(p_lat, p_lng))
           / 1609.344)::numeric, 1)::double precision as distance_mi
  from slots s
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

grant execute on function public.slots_near(double precision, double precision, double precision, integer, integer)
  to anon, authenticated;
