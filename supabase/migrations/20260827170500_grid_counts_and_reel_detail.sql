-- The grid now carries engagement counts, and a booked tile the creator has
-- hidden drops off their own grid without affecting the shooter's.
drop function if exists profile_grid(text,int,int);

create or replace function profile_grid(p_handle text, p_limit int default 30, p_offset int default 0)
returns table (
  id uuid, video_url text, poster_url text, caption text, aspect text,
  duration_seconds int, created_at timestamptz, source text, credit_name text,
  credit_handle text, booked_slot_id uuid, like_count int, comment_count int,
  liked_by_me boolean, live_slot_id uuid, live_closes_at timestamptz, live_cents int
)
language sql stable set search_path = public
as $$
  with target as (select id from profiles where handle = lower(p_handle)),
  tiles as (
    select r.id, r.video_url, r.poster_url, r.caption, r.aspect, r.duration_seconds,
      r.created_at, 'own'::text as source, null::text as credit_name,
      null::text as credit_handle, null::uuid as booked_slot_id
    from reels r where r.owner_id = (select id from target)
    union all
    select r.id, r.video_url, r.poster_url, r.caption, r.aspect, r.duration_seconds,
      coalesce(s.delivered_at, s.settled_at, s.closes_at), 'booked'::text,
      p.display_name, p.handle, s.id
    from slots s
    join reels r on r.id = s.delivered_reel_id
    join profiles p on p.id = s.videographer_id
    where s.winner_id = (select id from target) and s.status in ('won','claimed')
      and not s.hidden_from_winner_grid
  )
  select t.id, t.video_url, t.poster_url, t.caption, t.aspect, t.duration_seconds,
    t.created_at, t.source, t.credit_name, t.credit_handle, t.booked_slot_id,
    (select count(*)::int from reel_likes l where l.reel_id = t.id),
    (select count(*)::int from reel_comments c where c.reel_id = t.id),
    exists (select 1 from reel_likes l where l.reel_id = t.id and l.user_id = (select auth.uid())),
    live.id, live.closes_at, live.cents
  from tiles t
  left join lateral (
    select s.id, s.closes_at, coalesce(s.current_cents, s.floor_rate_cents) as cents
    from slots s where s.reel_id = t.id and s.status = 'open' and s.closes_at > now()
    order by s.closes_at limit 1
  ) live on t.source = 'own'
  order by t.created_at desc
  limit least(greatest(p_limit, 1), 60) offset greatest(p_offset, 0);
$$;
revoke all on function profile_grid(text,int,int) from public;
grant execute on function profile_grid(text,int,int) to authenticated, anon;

-- One reel, everything a permalink or a modal needs in a single round trip.
create or replace function reel_detail(p_reel uuid)
returns table (
  id uuid, video_url text, poster_url text, caption text, aspect text,
  duration_seconds int, created_at timestamptz, owner_id uuid, owner_name text,
  owner_handle text, owner_avatar_url text, like_count int, comment_count int,
  liked_by_me boolean, is_mine boolean, live_slot_id uuid,
  live_closes_at timestamptz, live_cents int
)
language sql stable set search_path = public
as $$
  select r.id, r.video_url, r.poster_url, r.caption, r.aspect, r.duration_seconds,
    r.created_at, p.id, p.display_name, p.handle, p.avatar_url,
    (select count(*)::int from reel_likes l where l.reel_id = r.id),
    (select count(*)::int from reel_comments c where c.reel_id = r.id),
    exists (select 1 from reel_likes l where l.reel_id = r.id and l.user_id = (select auth.uid())),
    r.owner_id = (select auth.uid()),
    live.id, live.closes_at, live.cents
  from reels r
  join profiles p on p.id = r.owner_id
  left join lateral (
    select s.id, s.closes_at, coalesce(s.current_cents, s.floor_rate_cents) as cents
    from slots s where s.reel_id = r.id and s.status = 'open' and s.closes_at > now()
    order by s.closes_at limit 1
  ) live on true
  where r.id = p_reel;
$$;
revoke all on function reel_detail(uuid) from public;
grant execute on function reel_detail(uuid) to authenticated, anon;

-- Comments with their author, and whether the caller may remove each one.
create or replace function reel_comments_for(p_reel uuid, p_limit int default 100)
returns table (
  id bigint, body text, created_at timestamptz, author_id uuid,
  author_name text, author_handle text, author_avatar text, can_delete boolean
)
language sql stable set search_path = public
as $$
  select c.id, c.body, c.created_at, p.id, p.display_name, p.handle, p.avatar_url,
    c.author_id = (select auth.uid())
      or exists (select 1 from reels r where r.id = c.reel_id and r.owner_id = (select auth.uid()))
  from reel_comments c join profiles p on p.id = c.author_id
  where c.reel_id = p_reel order by c.created_at
  limit least(greatest(p_limit, 1), 300);
$$;
revoke all on function reel_comments_for(uuid,int) from public;
grant execute on function reel_comments_for(uuid,int) to authenticated, anon;
