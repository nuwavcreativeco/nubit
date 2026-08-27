-- Keeps ghosting inside the system instead of invisible. Reports are
-- claims, not verdicts: nothing counts against anyone until upheld.
create table if not exists public.no_show_reports (
  id           bigserial primary key,
  slot_id      uuid not null references public.slots(id) on delete cascade,
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  subject_id   uuid not null references public.profiles(id) on delete cascade,
  note         text not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  upheld       boolean,
  unique (slot_id, reporter_id),
  check (reporter_id <> subject_id),
  check (resolved_at is null or upheld is not null)
);

alter table public.no_show_reports enable row level security;

create policy "see reports you filed" on public.no_show_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));

revoke all on public.no_show_reports from anon, authenticated;
grant select on public.no_show_reports to authenticated;

create index no_show_reports_subject_idx on public.no_show_reports (subject_id);
create index no_show_reports_reporter_idx on public.no_show_reports (reporter_id);
create index no_show_reports_slot_idx on public.no_show_reports (slot_id);
create index no_show_reports_open_idx on public.no_show_reports (created_at) where resolved_at is null;

create or replace function public.report_no_show(p_slot uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s        slots%rowtype;
  me       uuid := auth.uid();
  note     text := nullif(trim(p_note), '');
  subject  uuid;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;

  select * into s from slots where id = p_slot;
  if not found then raise exception 'no such slot' using errcode = 'P0002'; end if;

  if s.status not in ('won','claimed') then
    raise exception 'only a booked shoot can be reported' using errcode = 'P0001';
  end if;
  if s.shoot_date > current_date then
    raise exception 'the shoot date has not passed yet' using errcode = 'P0001';
  end if;

  if me = s.videographer_id then
    subject := s.winner_id;
  elsif me = s.winner_id then
    subject := s.videographer_id;
  else
    raise exception 'you were not on this shoot' using errcode = '42501';
  end if;

  if note is null or length(note) < 10 then
    raise exception 'please describe what happened (at least 10 characters)' using errcode = 'P0001';
  end if;

  insert into no_show_reports (slot_id, reporter_id, subject_id, note)
  values (p_slot, me, subject, note)
  on conflict (slot_id, reporter_id) do nothing;

  if not found then
    raise exception 'you already reported this shoot' using errcode = 'P0001';
  end if;

  return jsonb_build_object('outcome','reported','slot_id',p_slot);
end $$;

revoke all on function public.report_no_show(uuid, text) from public, anon;
grant execute on function public.report_no_show(uuid, text) to authenticated;
