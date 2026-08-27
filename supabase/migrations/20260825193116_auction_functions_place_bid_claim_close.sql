create or replace function place_bid(p_slot uuid, p_max_cents int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s           slots%rowtype;
  me          uuid := auth.uid();
  lead_max    int;
  lead_bidder uuid;
  new_price   int;
  new_leader  uuid;
  extended    boolean := false;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select * into s from slots where id = p_slot for update;

  if not found then raise exception 'no such slot' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'slot is not open' using errcode = 'P0001'; end if;
  if now() >= s.closes_at then raise exception 'bidding has closed' using errcode = 'P0001'; end if;
  if s.videographer_id = me then raise exception 'you cannot bid on your own slot' using errcode = 'P0001'; end if;

  if p_max_cents % s.step_cents <> 0 then
    raise exception 'bids move in $% steps', (s.step_cents / 100) using errcode = 'P0001';
  end if;
  if p_max_cents < s.floor_rate_cents then
    raise exception 'below the floor day rate' using errcode = 'P0001';
  end if;
  if p_max_cents > s.claim_cents then
    raise exception 'above claim-now - claim the day instead' using errcode = 'P0001';
  end if;

  select bidder_id, max_cents into lead_bidder, lead_max
  from bids where slot_id = p_slot
  order by max_cents desc, created_at asc
  limit 1;

  insert into bids (slot_id, bidder_id, max_cents) values (p_slot, me, p_max_cents);

  if lead_bidder is null then
    new_leader := me;
    new_price  := s.floor_rate_cents;
  elsif lead_bidder = me then
    new_leader := me;
    new_price  := s.current_cents;
  elsif p_max_cents > lead_max then
    new_leader := me;
    new_price  := least(lead_max + s.step_cents, p_max_cents);
  else
    new_leader := lead_bidder;
    new_price  := least(p_max_cents + s.step_cents, lead_max);
  end if;

  if new_price >= s.claim_cents then
    new_price := s.claim_cents;
    update slots set
      status = 'won', current_cents = new_price, leader_id = new_leader,
      settled_cents = new_price, winner_id = new_leader, settled_at = now(),
      bid_count = bid_count + 1
    where id = p_slot;

    return jsonb_build_object('outcome','ceiling_hit','price_cents',new_price,'leading',new_leader = me);
  end if;

  if s.closes_at - now() < interval '5 minutes' then
    extended := true;
  end if;

  update slots set
    current_cents = new_price,
    leader_id     = new_leader,
    bid_count     = bid_count + 1,
    closes_at     = case when extended then now() + interval '5 minutes' else closes_at end
  where id = p_slot;

  return jsonb_build_object(
    'outcome',     case when new_leader = me then 'leading' else 'outbid' end,
    'price_cents', new_price,
    'your_max',    p_max_cents,
    'extended',    extended
  );
end;
$$;

create or replace function claim_slot(p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  return jsonb_build_object('outcome','claimed','price_cents',s.claim_cents);
end;
$$;

create or replace function close_due_slots()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  with due as (
    update slots set
      status        = case when leader_id is null then 'expired' else 'won' end,
      settled_cents = current_cents,
      winner_id     = leader_id,
      settled_at    = now()
    where status = 'open' and closes_at <= now()
    returning 1
  )
  select count(*) into n from due;
  return n;
end;
$$;

revoke execute on function place_bid(uuid,int)  from anon;
revoke execute on function claim_slot(uuid)     from anon;
revoke execute on function close_due_slots()    from anon, authenticated;
grant  execute on function place_bid(uuid,int)  to authenticated;
grant  execute on function claim_slot(uuid)     to authenticated;
