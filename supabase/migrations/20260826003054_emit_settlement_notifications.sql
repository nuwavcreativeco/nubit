-- close_due_slots now returns the settled rows so it can fan out
-- notifications in the same transaction as the settlement itself.
create or replace function public.close_due_slots()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int;
begin
  create temporary table _closed on commit drop as
  with due as (
    update slots set
      status        = case when leader_id is null then 'expired' else 'won' end,
      settled_cents = current_cents,
      winner_id     = leader_id,
      settled_at    = now()
    where status = 'open' and closes_at <= now()
    returning id, title, shoot_date, videographer_id, winner_id, settled_cents, status
  )
  select * from due;

  select count(*) into n from _closed;
  if n = 0 then return 0; end if;

  -- Winner and videographer on a sold slot.
  insert into notifications (user_id, kind, slot_id, payload)
  select c.winner_id, 'won', c.id,
         jsonb_build_object('title', c.title, 'shoot_date', c.shoot_date, 'price_cents', c.settled_cents)
  from _closed c where c.status = 'won';

  insert into notifications (user_id, kind, slot_id, payload)
  select c.videographer_id, 'sold', c.id,
         jsonb_build_object('title', c.title, 'shoot_date', c.shoot_date, 'price_cents', c.settled_cents)
  from _closed c where c.status = 'won';

  -- Everyone who bid and did not win.
  insert into notifications (user_id, kind, slot_id, payload)
  select distinct b.bidder_id, 'lost', c.id,
         jsonb_build_object('title', c.title, 'shoot_date', c.shoot_date, 'price_cents', c.settled_cents)
  from _closed c
  join bids b on b.slot_id = c.id
  where c.status = 'won' and b.bidder_id is distinct from c.winner_id;

  -- Nobody bid.
  insert into notifications (user_id, kind, slot_id, payload)
  select c.videographer_id, 'expired', c.id,
         jsonb_build_object('title', c.title, 'shoot_date', c.shoot_date)
  from _closed c where c.status = 'expired';

  return n;
end $$;

-- claim_slot: tell the videographer their day just sold outright.
create or replace function public.claim_slot(p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s  slots%rowtype;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;

  select * into s from slots where id = p_slot for update;

  if not found then raise exception 'no such slot' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'this day is already taken' using errcode = 'P0001'; end if;
  if now() >= s.closes_at then raise exception 'bidding has closed' using errcode = 'P0001'; end if;
  if s.videographer_id = me then raise exception 'you cannot claim your own slot' using errcode = 'P0001'; end if;

  update slots set
    status = 'claimed', current_cents = s.claim_cents,
    settled_cents = s.claim_cents, winner_id = me, settled_at = now(), leader_id = me
  where id = p_slot;

  insert into notifications (user_id, kind, slot_id, payload)
  values (s.videographer_id, 'sold_claim', p_slot,
          jsonb_build_object('title', s.title, 'shoot_date', s.shoot_date, 'price_cents', s.claim_cents));

  -- Anyone who had bid on this slot lost it to the claim.
  insert into notifications (user_id, kind, slot_id, payload)
  select distinct b.bidder_id, 'lost', p_slot,
         jsonb_build_object('title', s.title, 'shoot_date', s.shoot_date, 'price_cents', s.claim_cents)
  from bids b where b.slot_id = p_slot and b.bidder_id <> me;

  return jsonb_build_object('outcome','claimed','price_cents',s.claim_cents);
end $$;
