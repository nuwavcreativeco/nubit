alter table public.notifications
  add column if not exists email_attempts   integer not null default 0,
  add column if not exists email_error      text,
  add column if not exists email_claimed_at timestamptz;

drop index if exists public.notifications_pending_email_idx;

create index notifications_email_queue_idx
  on public.notifications (created_at)
  where emailed_at is null and email_attempts < 5;

-- Atomically claim a batch. SKIP LOCKED means two concurrent workers never
-- grab the same row; the 10-minute reclaim window recovers rows whose worker
-- died mid-send. Nothing is marked sent until the provider confirms.
create or replace function public.claim_notification_emails(p_limit integer default 50)
returns table (
  id       bigint,
  user_id  uuid,
  email    text,
  kind     text,
  slot_id  uuid,
  payload  jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  update public.notifications n
     set email_claimed_at = now(),
         email_attempts   = n.email_attempts + 1
   where n.id in (
     select x.id
       from public.notifications x
      where x.emailed_at is null
        and x.email_attempts < 5
        and (x.email_claimed_at is null or x.email_claimed_at < now() - interval '10 minutes')
      order by x.created_at
      limit p_limit
      for update skip locked
   )
  returning
    n.id,
    n.user_id,
    (select u.email::text from auth.users u where u.id = n.user_id),
    n.kind,
    n.slot_id,
    n.payload;
end $$;

create or replace function public.complete_notification_emails(
  p_sent   bigint[] default '{}',
  p_failed bigint[] default '{}',
  p_error  text     default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int := 0;
begin
  if array_length(p_sent, 1) is not null then
    update public.notifications
       set emailed_at = now(), email_error = null, email_claimed_at = null
     where id = any(p_sent) and emailed_at is null;
    get diagnostics n = row_count;
  end if;

  if array_length(p_failed, 1) is not null then
    update public.notifications
       set email_error = left(coalesce(p_error, 'unknown error'), 500),
           email_claimed_at = null
     where id = any(p_failed) and emailed_at is null;
  end if;

  return n;
end $$;

-- Worker-only. Never exposed to anon or authenticated.
revoke all on function public.claim_notification_emails(integer) from public, anon, authenticated;
revoke all on function public.complete_notification_emails(bigint[], bigint[], text) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
grant execute on function public.complete_notification_emails(bigint[], bigint[], text) to service_role;
