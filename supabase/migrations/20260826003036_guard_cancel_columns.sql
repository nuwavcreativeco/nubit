-- Now that cancel_slot() exists, direct status writes to 'cancelled' are
-- closed off entirely: publishing a draft is the only client-side transition.
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
     or new.cancel_reason   is distinct from old.cancel_reason then
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
