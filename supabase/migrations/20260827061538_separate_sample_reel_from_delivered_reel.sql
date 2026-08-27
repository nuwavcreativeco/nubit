-- slots.reel_id is the sample: the work a shooter fronts a day with, chosen
-- from their own grid. It says "this is the kind of thing I make".
--
-- What a creator earns a grid tile for is the DELIVERY -- the reel actually
-- cut from their shoot -- which does not exist until after the day happens.
-- Conflating the two put the shooter's sample on the creator's portfolio, and
-- dropped bookings that had no sample attached at all.
alter table slots
  add column if not exists delivered_reel_id uuid references reels(id) on delete set null,
  add column if not exists delivered_at      timestamptz;

create index if not exists slots_delivered_reel_idx on slots (delivered_reel_id);

comment on column slots.reel_id is
  'Sample work the day was advertised with. Belongs to the videographer.';
comment on column slots.delivered_reel_id is
  'The reel cut from this shoot. Populates the winner''s profile grid.';

-- The shooter attaches the delivery once the day is settled.
create or replace function deliver_reel(p_slot uuid, p_reel uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  s  slots;
begin
  select * into s from slots where id = p_slot for update;

  if not found then
    raise exception 'no such slot' using errcode = '22023';
  end if;
  if s.videographer_id <> me then
    raise exception 'only the videographer delivers this shoot' using errcode = '42501';
  end if;
  if s.status not in ('won','claimed') then
    raise exception 'nothing was booked on this day' using errcode = '22023';
  end if;
  if not exists (select 1 from reels where id = p_reel and owner_id = me) then
    raise exception 'that reel is not yours' using errcode = '42501';
  end if;

  update slots
     set delivered_reel_id = p_reel,
         delivered_at      = now()
   where id = p_slot;

  insert into notifications (user_id, kind, slot_id, payload)
  select s.winner_id, 'delivered', p_slot,
         jsonb_build_object('slot_id', p_slot, 'reel_id', p_reel,
                            'title', s.title, 'from_name', p.display_name)
  from profiles p where p.id = me and s.winner_id is not null;

  return jsonb_build_object('outcome','delivered','slot_id',p_slot,'reel_id',p_reel);
end;
$$;

revoke all on function deliver_reel(uuid,uuid) from public, anon;
grant execute on function deliver_reel(uuid,uuid) to authenticated;

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind = any (array[
    'won','sold','lost','outbid','expired','claimed','sold_claim',
    'cancelled_by_videographer','cancelled_by_winner',
    'followed_posted','message',
    'offer_received','offer_accepted','offer_declined','offer_withdrawn',
    'delivered'
  ]));

-- Grid, corrected: a creator's tiles are deliveries, credited to the shooter.
-- A booking with nothing delivered yet simply has no tile, rather than
-- borrowing the shooter's sample.
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
    select
      r.id, r.video_url, r.poster_url, r.caption, r.aspect,
      r.duration_seconds, r.created_at,
      'own'::text as source, null::text as credit_name, null::text as credit_handle
    from reels r
    where r.owner_id = (select id from target)

    union all

    select
      r.id, r.video_url, r.poster_url, r.caption, r.aspect,
      r.duration_seconds, coalesce(s.delivered_at, s.settled_at, s.closes_at),
      'booked'::text, p.display_name, p.handle
    from slots s
    join reels    r on r.id = s.delivered_reel_id
    join profiles p on p.id = s.videographer_id
    where s.winner_id = (select id from target)
      and s.status in ('won','claimed')
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
