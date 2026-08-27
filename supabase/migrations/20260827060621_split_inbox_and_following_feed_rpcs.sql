-- The board, filtered to people you follow. This is what the bell points at:
-- follow someone, and their day shows up here the moment it is posted.
create or replace function slots_following(p_limit int default 50, p_offset int default 0)
returns table (
  id                uuid,
  title             text,
  shoot_date        date,
  location          text,
  area_label        text,
  floor_rate_cents  int,
  current_cents     int,
  claim_cents       int,
  closes_at         timestamptz,
  bid_count         int,
  reel_url          text,
  poster_url        text,
  aspect            text,
  videographer_id   uuid,
  videographer_name text,
  handle            text,
  avatar_url        text
)
language sql
stable
set search_path = public
as $$
  select
    s.id, s.title, s.shoot_date, s.location, s.area_label,
    s.floor_rate_cents, s.current_cents, s.claim_cents,
    s.closes_at, s.bid_count,
    coalesce(r.video_url,  s.reel_url),
    coalesce(r.poster_url, s.poster_url),
    coalesce(r.aspect, '16:9'),
    s.videographer_id, p.display_name, p.handle, p.avatar_url
  from slots s
  join follows  f on f.followee_id = s.videographer_id
                 and f.follower_id = (select auth.uid())
  join profiles p on p.id = s.videographer_id
  left join reels r on r.id = s.reel_id
  where s.status = 'open'
    and s.closes_at > now()
  order by s.closes_at
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke all on function slots_following(int,int) from public, anon;
grant execute on function slots_following(int,int) to authenticated;

-- Two boxes, one query. A thread is "primary" when a follow runs either way
-- between the two of you; everything else is a cold request. Nothing is
-- blocked or rate limited -- it is only sorted.
--
-- Invoker, not definer: the participants and messages policies already scope
-- these reads to threads the caller is in.
create or replace function my_inbox(p_folder text default 'primary')
returns table (
  conversation_id  uuid,
  other_id         uuid,
  other_name       text,
  other_handle     text,
  other_avatar_url text,
  last_message_at  timestamptz,
  preview          text,
  unread           int,
  is_primary       boolean
)
language sql
stable
set search_path = public
as $$
  with me as (select (select auth.uid()) as id),
  mine as (
    select cp.conversation_id, cp.last_read_at
    from conversation_participants cp, me
    where cp.user_id = me.id
  ),
  paired as (
    select m.conversation_id, m.last_read_at, cp.user_id as other_id
    from mine m
    join conversation_participants cp
      on cp.conversation_id = m.conversation_id
     and cp.user_id <> (select id from me)
  )
  select
    o.conversation_id,
    o.other_id,
    p.display_name,
    p.handle,
    p.avatar_url,
    c.last_message_at,
    (select left(x.body, 140) from messages x
      where x.conversation_id = o.conversation_id
      order by x.created_at desc limit 1),
    (select count(*)::int from messages x
      where x.conversation_id = o.conversation_id
        and x.sender_id <> (select id from me)
        and (o.last_read_at is null or x.created_at > o.last_read_at)),
    prim.is_primary
  from paired o
  join conversations c on c.id = o.conversation_id
  join profiles p      on p.id = o.other_id
  cross join lateral (
    select exists (
      select 1 from follows f
      where (f.follower_id = (select id from me) and f.followee_id = o.other_id)
         or (f.follower_id = o.other_id and f.followee_id = (select id from me))
    ) as is_primary
  ) prim
  where case
          when p_folder = 'requests' then not prim.is_primary
          else prim.is_primary
        end
  order by c.last_message_at desc;
$$;

revoke all on function my_inbox(text) from public, anon;
grant execute on function my_inbox(text) to authenticated;

create or replace function mark_conversation_read(p_conv uuid)
returns void
language sql
volatile
set search_path = public
as $$
  update conversation_participants
     set last_read_at = now()
   where conversation_id = p_conv
     and user_id = (select auth.uid());
$$;

revoke all on function mark_conversation_read(uuid) from public, anon;
grant execute on function mark_conversation_read(uuid) to authenticated;

-- Badge counts for the two boxes plus the bell, in one call.
create or replace function my_badges()
returns table (primary_unread int, request_unread int, bell_unread int)
language sql
stable
set search_path = public
as $$
  select
    coalesce((select sum(unread)::int from my_inbox('primary')),  0),
    coalesce((select sum(unread)::int from my_inbox('requests')), 0),
    (select count(*)::int from notifications
      where user_id = (select auth.uid()) and read_at is null);
$$;

revoke all on function my_badges() from public, anon;
grant execute on function my_badges() to authenticated;
