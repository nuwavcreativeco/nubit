-- New notification kind: someone you follow just put a day on the board.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind = any (array[
    'won','sold','lost','outbid','expired','claimed','sold_claim',
    'cancelled_by_videographer','cancelled_by_winner',
    'followed_posted','message'
  ]));

-- One bell per follower per day, however many times the row is touched.
create unique index if not exists notifications_followed_posted_once
  on notifications (user_id, slot_id)
  where kind = 'followed_posted';

-- The bell is the whole point of following: it is what turns a follow into
-- first pick, so it fires the moment the day becomes visible on the board.
create or replace function notify_followers_of_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (user_id, kind, slot_id, payload)
  select
    f.follower_id,
    'followed_posted',
    new.id,
    jsonb_build_object(
      'videographer_id',   new.videographer_id,
      'videographer_name', p.display_name,
      'handle',            p.handle,
      'title',             new.title,
      'shoot_date',        new.shoot_date,
      'floor_rate_cents',  new.floor_rate_cents,
      'closes_at',         new.closes_at
    )
  from follows f
  join profiles p on p.id = new.videographer_id
  where f.followee_id = new.videographer_id
    -- never bell someone about their own day
    and f.follower_id <> new.videographer_id
  on conflict do nothing;

  return null;
end;
$$;

revoke all on function notify_followers_of_slot() from public;

drop trigger if exists slots_notify_followers_ins on slots;
create trigger slots_notify_followers_ins
  after insert on slots
  for each row
  when (new.status = 'open')
  execute function notify_followers_of_slot();

-- A day drafted first and opened later still rings.
drop trigger if exists slots_notify_followers_upd on slots;
create trigger slots_notify_followers_upd
  after update of status on slots
  for each row
  when (new.status = 'open' and old.status is distinct from 'open')
  execute function notify_followers_of_slot();
