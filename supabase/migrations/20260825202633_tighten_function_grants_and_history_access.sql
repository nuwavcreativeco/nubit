-- my earlier revokes named the roles, but PUBLIC still held EXECUTE,
-- and anon/authenticated inherit from PUBLIC. Revoke there instead.
revoke all on function place_bid(uuid,int)   from public;
revoke all on function claim_slot(uuid)      from public;
revoke all on function close_due_slots()     from public;

grant execute on function place_bid(uuid,int) to authenticated;
grant execute on function claim_slot(uuid)    to authenticated;
-- close_due_slots is cron-only; nothing web-facing may call it
grant execute on function close_due_slots()   to service_role;

-- replace the definer VIEW with a definer FUNCTION scoped to one slot,
-- so elevated reads can't be queried in bulk
drop view if exists slot_bid_history;

create or replace function slot_bid_history(p_slot uuid)
returns table (bid_at timestamptz, bidder text, is_you boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.created_at,
    case
      when s.status in ('won','claimed','expired') or b.bidder_id = auth.uid()
        then p.display_name
      else regexp_replace(p.display_name, '(?<=\S)\S', '*', 'g')
    end,
    b.bidder_id = auth.uid()
  from bids b
  join slots s    on s.id = b.slot_id
  join profiles p on p.id = b.bidder_id
  where b.slot_id = p_slot
    and (s.status <> 'draft' or s.videographer_id = auth.uid())
  order by b.created_at desc;
$$;

revoke all on function slot_bid_history(uuid) from public;
grant execute on function slot_bid_history(uuid) to authenticated, anon;
