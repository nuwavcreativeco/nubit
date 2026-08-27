-- Covering indexes for foreign keys that had none (Supabase lint 0001).
-- Without these, deleting/updating a parent row forces a seq scan on the child.

create index if not exists reviews_author_id_idx
  on public.reviews (author_id);

create index if not exists slots_leader_id_idx
  on public.slots (leader_id);

create index if not exists slots_winner_id_idx
  on public.slots (winner_id);
