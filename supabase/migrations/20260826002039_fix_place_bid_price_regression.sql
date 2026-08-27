create or replace function public.place_bid(p_slot uuid, p_max_cents integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s           slots%rowtype;
  me          uuid := auth.uid();
  lead_max    int;
  lead_bidder uuid;
  new_price   int;
  new_leader  uuid;
  min_needed  int;
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

  -- NEW: a challenger must at least beat the standing price by one step.
  -- Without this, a minimum bid on an already-bid-up slot walked
  -- current_cents backwards.
  if s.current_cents is not null and s.leader_id is distinct from me then
    min_needed := s.current_cents + s.step_cents;
    if p_max_cents < min_needed then
      raise exception 'bid at least $% to beat the current price', (min_needed / 100)
        using errcode = 'P0001';
    end if;
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

  -- NEW: belt and braces - the price is monotonic, it never ratchets down.
  new_price := greatest(new_price, coalesce(s.current_cents, s.floor_rate_cents));

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
$function$;
