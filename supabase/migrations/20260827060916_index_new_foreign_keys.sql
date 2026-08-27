-- Both flagged by the linter right after the messaging tables landed.
create index if not exists conversations_slot_id_idx
  on conversations (slot_id);

create index if not exists messages_sender_id_idx
  on messages (sender_id);
