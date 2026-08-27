-- RLS can gate rows but not columns. These tables are written directly by
-- `authenticated` via PostgREST for create/edit, while auction state is
-- meant to be owned by place_bid / claim_slot / close_due_slots.
--
-- Those RPCs are SECURITY DEFINER, so inside them current_user is 'postgres'
-- and this guard is a no-op. A direct PostgREST write runs as 'authenticated'
-- and gets checked.

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
    -- Auction state is platform-owned; normalise it to its initial values
    -- rather than trusting whatever the client posted.
    new.status         := case when new.status = 'draft' then 'draft' else 'open' end;
    new.current_cents  := null;
    new.leader_id      := null;
    new.bid_count      := 0;
    new.settled_cents  := null;
    new.winner_id      := null;
    new.settled_at     := null;
    new.awarded_bid_id := null;

    if new.closes_at <= now() then
      raise exception 'closes_at must be in the future' using errcode = '22023';
    end if;

    return new;
  end if;

  -- UPDATE from here down.
  if new.id <> old.id
     or new.videographer_id <> old.videographer_id
     or new.created_at      <> old.created_at
     or new.current_cents   is distinct from old.current_cents
     or new.leader_id       is distinct from old.leader_id
     or new.bid_count       <> old.bid_count
     or new.settled_cents   is distinct from old.settled_cents
     or new.winner_id       is distinct from old.winner_id
     or new.settled_at      is distinct from old.settled_at
     or new.awarded_bid_id  is distinct from old.awarded_bid_id then
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
    if not (
         (old.status = 'draft' and new.status in ('open', 'cancelled'))
      or (old.status = 'open'  and new.status = 'cancelled' and old.bid_count = 0)
    ) then
      raise exception 'not a permitted status change' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists guard_slot_writes on public.slots;

create trigger guard_slot_writes
  before insert or update on public.slots
  for each row execute function public.guard_slot_writes();
