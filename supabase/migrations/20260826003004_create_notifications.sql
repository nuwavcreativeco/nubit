create table if not exists public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in (
                'won','sold','lost','outbid','expired','claimed','sold_claim',
                'cancelled_by_videographer','cancelled_by_winner'
              )),
  slot_id     uuid references public.slots(id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz
);

alter table public.notifications enable row level security;

-- Read-only to the owner. Writes come exclusively from SECURITY DEFINER
-- functions, which run as postgres and bypass RLS.
create policy "see your own notifications" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create index notifications_inbox_idx
  on public.notifications (user_id, created_at desc);

-- Drives the outbound mailer: cheap to scan, shrinks as mail goes out.
create index notifications_pending_email_idx
  on public.notifications (created_at)
  where emailed_at is null;

alter publication supabase_realtime add table public.notifications;

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  n  int;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;

  with touched as (
    update notifications
       set read_at = now()
     where user_id = me
       and read_at is null
       and (p_ids is null or id = any(p_ids))
    returning 1
  )
  select count(*) into n from touched;

  return n;
end $$;

revoke all on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;
