-- Previously the policy verified the author was on the shoot but never
-- constrained subject_id, so a valid participant could review anyone.
-- Now the subject must be the other side of that specific slot.

alter policy "review a shoot you were on" on public.reviews
  to authenticated
  with check (
    author_id = (select auth.uid())
    and subject_id <> author_id
    and exists (
      select 1
      from public.slots s
      where s.id = reviews.slot_id
        and s.status = any (array['won'::text, 'claimed'::text])
        and (
          ((select auth.uid()) = s.winner_id        and reviews.subject_id = s.videographer_id)
          or
          ((select auth.uid()) = s.videographer_id  and reviews.subject_id = s.winner_id)
        )
    )
  );
