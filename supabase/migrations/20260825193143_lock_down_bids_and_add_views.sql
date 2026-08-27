drop policy if exists "bidders create their own bids" on bids;
drop policy if exists "bids are publicly readable" on bids;

create policy "see your own bids" on bids for select using (bidder_id = auth.uid());
revoke insert, update, delete on bids from authenticated, anon;

create policy "reviews are public" on reviews for select using (true);
create policy "review a shoot you were on" on reviews for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from slots s
      where s.id = slot_id
        and s.status in ('won','claimed')
        and auth.uid() in (s.winner_id, s.videographer_id)
    )
  );

drop policy if exists "slots are publicly readable" on slots;
create policy "slots are publicly readable" on slots for select
  using (status <> 'draft' or videographer_id = auth.uid());

-- definer view on purpose: reads every bid, but only ever emits a masked name
create or replace view slot_bid_history as
select
  b.slot_id,
  b.created_at,
  case
    when s.status in ('won','claimed','expired') or b.bidder_id = auth.uid()
      then p.display_name
    else regexp_replace(p.display_name, '(?<=\S)\S', '*', 'g')
  end as bidder,
  b.bidder_id = auth.uid() as is_you
from bids b
join slots s    on s.id = b.slot_id
join profiles p on p.id = b.bidder_id;

grant select on slot_bid_history to authenticated, anon;

create or replace view videographer_stats
with (security_invoker = on) as
select
  p.id,
  count(distinct s.id) filter (where s.status in ('won','claimed')) as shoots_done,
  round(avg(r.rating), 1)                                           as rating,
  count(r.id)                                                       as review_count
from profiles p
left join slots   s on s.videographer_id = p.id
left join reviews r on r.subject_id = p.id
group by p.id;

grant select on videographer_stats to authenticated, anon;
