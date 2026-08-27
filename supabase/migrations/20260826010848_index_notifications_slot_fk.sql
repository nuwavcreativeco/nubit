-- Matters on cascade: deleting a slot has to find its notifications.
create index if not exists notifications_slot_idx on public.notifications (slot_id);
