create table if not exists conversations (
  id              uuid        primary key default gen_random_uuid(),
  -- where the thread started, if it started from a day. Kept for context
  -- only; the thread outlives the day.
  slot_id         uuid        references slots(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists conversation_participants (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references profiles(id)      on delete cascade,
  last_read_at    timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_by_user
  on conversation_participants (user_id);

create table if not exists messages (
  id              bigserial   primary key,
  conversation_id uuid        not null references conversations(id) on delete cascade,
  sender_id       uuid        not null references profiles(id)      on delete cascade,
  body            text        not null
                    check (length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now()
);

create index if not exists messages_by_conversation
  on messages (conversation_id, created_at desc);

-- Membership is read through a definer so the participants policy never has
-- to query its own table -- that self-reference is what sends RLS into
-- infinite recursion. The auth.uid() check lives inside the body, so the
-- elevated read can only ever answer "am *I* in this thread".
create or replace function is_conversation_participant(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conv
      and user_id = (select auth.uid())
  );
$$;

revoke all on function is_conversation_participant(uuid) from public;
grant execute on function is_conversation_participant(uuid) to authenticated;

alter table conversations             enable row level security;
alter table conversation_participants enable row level security;
alter table messages                  enable row level security;

create policy "read threads you are in" on conversations
  for select to authenticated
  using (is_conversation_participant(id));

create policy "read participants of your threads" on conversation_participants
  for select to authenticated
  using (is_conversation_participant(conversation_id));

create policy "mark your own row read" on conversation_participants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "read messages in your threads" on messages
  for select to authenticated
  using (is_conversation_participant(conversation_id));

create policy "send as yourself into your threads" on messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and is_conversation_participant(conversation_id)
  );

-- Threads are created through start_conversation(), never by hand.
revoke insert, update, delete on conversations             from authenticated, anon;
revoke insert, delete         on conversation_participants from authenticated, anon;
revoke update, delete         on messages                  from authenticated, anon;

-- Anyone may open a thread with anyone: cold messages are sorted, not
-- blocked.
create or replace function start_conversation(p_user uuid, p_slot uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := (select auth.uid());
  conv uuid;
begin
  if me is null then
    raise exception 'must be signed in';
  end if;
  if p_user = me then
    raise exception 'cannot message yourself';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'no such person';
  end if;

  select c.id into conv
  from conversations c
  join conversation_participants a on a.conversation_id = c.id and a.user_id = me
  join conversation_participants b on b.conversation_id = c.id and b.user_id = p_user
  limit 1;

  if conv is not null then
    return conv;
  end if;

  insert into conversations (slot_id) values (p_slot) returning id into conv;
  insert into conversation_participants (conversation_id, user_id)
  values (conv, me), (conv, p_user);

  return conv;
end;
$$;

revoke all on function start_conversation(uuid,uuid) from public;
grant execute on function start_conversation(uuid,uuid) to authenticated;

-- Keep the thread ordered by recency and ring the other side.
create or replace function on_message_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;

  insert into notifications (user_id, kind, payload)
  select
    cp.user_id,
    'message',
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'sender_id',       new.sender_id,
      'sender_name',     p.display_name,
      'preview',         left(new.body, 140)
    )
  from conversation_participants cp
  join profiles p on p.id = new.sender_id
  where cp.conversation_id = new.conversation_id
    and cp.user_id <> new.sender_id;

  return null;
end;
$$;

revoke all on function on_message_sent() from public;

drop trigger if exists messages_after_insert on messages;
create trigger messages_after_insert
  after insert on messages
  for each row execute function on_message_sent();
