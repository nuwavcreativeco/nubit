-- Wrap auth.uid() in a scalar subquery so Postgres evaluates it once
-- per statement instead of once per row (Supabase lint 0003).

alter policy "slots are publicly readable" on public.slots
  using (
    status <> 'draft'
    or videographer_id = (select auth.uid())
  );

alter policy "see your own bids" on public.bids
  to authenticated
  using (bidder_id = (select auth.uid()));

alter policy "review a shoot you were on" on public.reviews
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1
      from public.slots s
      where s.id = reviews.slot_id
        and s.status = any (array['won'::text, 'claimed'::text])
        and (
          (select auth.uid()) = s.winner_id
          or (select auth.uid()) = s.videographer_id
        )
    )
  );
