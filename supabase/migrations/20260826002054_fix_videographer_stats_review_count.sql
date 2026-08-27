-- The old definition left-joined slots and reviews off the same profile,
-- producing a cross product that multiplied review_count by shoots_done.
-- Scalar subqueries keep the two aggregates independent.

create or replace view public.videographer_stats
with (security_invoker = on) as
select
  p.id,
  (select count(*)
     from public.slots s
    where s.videographer_id = p.id
      and s.status = any (array['won'::text, 'claimed'::text])) as shoots_done,
  (select round(avg(r.rating), 1)
     from public.reviews r
    where r.subject_id = p.id)                                   as rating,
  (select count(*)
     from public.reviews r
    where r.subject_id = p.id)                                   as review_count
from public.profiles p;
