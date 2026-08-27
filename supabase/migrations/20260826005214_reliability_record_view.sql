-- Reliability is platform-recorded and ungameable; ratings stay collected
-- but hidden until they have enough density to discriminate.
-- Existing columns keep their position and type so current callers still work.
create or replace view public.videographer_stats
with (security_invoker = on) as
select
  p.id,

  -- shoots_done: unchanged meaning, booked shoots as the videographer.
  (select count(*) from public.slots s
    where s.videographer_id = p.id
      and s.status = any (array['won','claimed']))                    as shoots_done,

  -- Suppressed below 3 reviews rather than shown as a thin average.
  (select case when count(r.id) >= 3 then round(avg(r.rating), 1) end
     from public.reviews r where r.subject_id = p.id)                 as rating,

  (select count(*) from public.reviews r
    where r.subject_id = p.id)                                        as review_count,

  -- Booked shoots whose date has actually passed.
  (select count(*) from public.slots s
    where s.videographer_id = p.id
      and s.status = any (array['won','claimed'])
      and s.shoot_date < current_date)                                as shoots_completed,

  -- The same person acting as the artist side.
  (select count(*) from public.slots s
    where s.winner_id = p.id
      and s.status = any (array['won','claimed']))                    as bookings_won,

  -- Bailed on a deal that already existed, either role. This is the one
  -- that matters.
  (select count(*) from public.slots s
    where s.status = 'cancelled'
      and s.cancelled_by = p.id
      and s.cancelled_from = any (array['won','claimed']))            as late_cancels,

  -- Pulled a live auction that people had already bid on.
  (select count(*) from public.slots s
    where s.status = 'cancelled'
      and s.cancelled_by = p.id
      and s.cancelled_from = 'open'
      and s.bid_count > 0)                                            as withdrawn_auctions,

  -- Only upheld reports count. Unresolved claims never touch the record.
  (select count(*) from public.no_show_reports nr
    where nr.subject_id = p.id and nr.upheld is true)                 as confirmed_no_shows,

  -- Below this bar the denominator is too small to mean anything; the UI
  -- should show "New to Nubid" instead of a record.
  ((select count(*) from public.slots s
     where (s.videographer_id = p.id or s.winner_id = p.id)
       and s.status = any (array['won','claimed'])) >= 5)             as reliability_shown,

  ((select count(*) from public.reviews r
     where r.subject_id = p.id) >= 3)                                 as rating_shown

from public.profiles p;
