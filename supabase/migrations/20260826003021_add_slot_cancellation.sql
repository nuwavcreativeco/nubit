alter table public.slots
  add column if not exists cancelled_at    timestamptz,
  add column if not exists cancelled_by    uuid references public.profiles(id),
  add column if not exists cancelled_from  text,
  add column if not exists cancel_reason   text;

create index if not exists slots_cancelled_by_idx on public.slots (cancelled_by);

-- Cancelling is an audited action, never a bare status write.
create or replace function public.cancel_slot(p_slot uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s        slots%rowtype;
  me       uuid := auth.uid();
  reason   text := nullif(trim(p_reason), '');
  is_owner boolean;
  is_win   boolean;
  late     boolean;
  n_bidders int := 0;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;

  select * into s from slots where id = p_slot for update;
  if not found then raise exception 'no such slot' using errcode = 'P0002'; end if;

  is_owner := (s.videographer_id = me);
  is_win   := (s.winner_id is not null and s.winner_id = me);

  if not (is_owner or is_win) then
    raise exception 'not your slot to cancel' using errcode = '42501';
  end if;
  if s.status not in ('draft','open','won','claimed') then
    raise exception 'slot cannot be cancelled from status %', s.status using errcode = 'P0001';
  end if;
  -- The winner may only back out of a deal, not kill a live auction.
  if is_win and not is_owner and s.status not in ('won','claimed') then
    raise exception 'only the videographer can cancel a live auction' using errcode = '42501';
  end if;

  late := (s.status in ('won','claimed'));

  -- A cancel that costs someone something has to come with an explanation.
  if (late or s.bid_count > 0) and (reason is null or length(reason) < 10) then
    raise exception 'a reason of at least 10 characters is required' using errcode = 'P0001';
  end if;

  update slots set
    status         = 'cancelled',
    cancelled_at   = now(),
    cancelled_by   = me,
    cancelled_from = s.status,
    cancel_reason  = reason
  where id = p_slot;

  -- Tell whoever is out a shoot.
  if late then
    if is_owner then
      insert into notifications (user_id, kind, slot_id, payload)
      values (s.winner_id, 'cancelled_by_videographer', p_slot,
              jsonb_build_object('title', s.title, 'shoot_date', s.shoot_date,
                                 'price_cents', s.settled_cents, 'reason', reason));
    else
      insert into notifications (user_id, kind, slot_id, payload)
      values (s.videographer_id, 'cancelled_by_winner', p_slot,
              jsonb_build_object('title', s.title, 'shoot_date', s.shoot_date,
                                 'price_cents', s.settled_cents, 'reason', reason));
    end if;
  elsif s.bid_count > 0 then
    insert into notifications (user_id, kind, slot_id, payload)
    select distinct b.bidder_id, 'cancelled_by_videographer', p_slot,
           jsonb_build_object('title', s.title, 'shoot_date', s.shoot_date, 'reason', reason)
    from bids b where b.slot_id = p_slot and b.bidder_id <> me;
    get diagnostics n_bidders = row_count;
  end if;

  return jsonb_build_object(
    'outcome',        'cancelled',
    'from',           s.status,
    'late',           late,
    'notified',       case when late then 1 else n_bidders end
  );
end $$;

revoke all on function public.cancel_slot(uuid, text) from public, anon;
grant execute on function public.cancel_slot(uuid, text) to authenticated;
