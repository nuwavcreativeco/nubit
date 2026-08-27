-- These are strict prefixes of existing composite indexes, so they add
-- write cost and storage without ever being the better plan:
--   bids_slot_id_idx (slot_id)            <- covered by bids_slot_idx (slot_id, max_cents desc, created_at)
--   slots_videographer_id_idx (videographer_id) <- covered by slots_by_owner (videographer_id, shoot_date desc)
-- The FK integrity checks on bids.slot_id and slots.videographer_id are
-- still satisfied by the composite indexes' leading column.

drop index if exists public.bids_slot_id_idx;
drop index if exists public.slots_videographer_id_idx;
