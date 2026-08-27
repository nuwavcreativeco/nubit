-- Engagement on a reel: a like, and a comment thread. Both are public to
-- read, because a profile grid is a portfolio and the point is that strangers
-- can see the work is well received. Writing is signed-in only, and every row
-- is pinned to its author by policy.

create table if not exists reel_likes (
  reel_id    uuid        not null references reels(id) on delete cascade,
  user_id    uuid        not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);
create index if not exists reel_likes_by_reel on reel_likes (reel_id);
alter table reel_likes enable row level security;
create policy "likes are public" on reel_likes for select using (true);
create policy "like as yourself" on reel_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "unlike your own" on reel_likes for delete to authenticated
  using (user_id = (select auth.uid()));
revoke update on reel_likes from authenticated, anon;

create table if not exists reel_comments (
  id         bigserial   primary key,
  reel_id    uuid        not null references reels(id) on delete cascade,
  author_id  uuid        not null references profiles(id) on delete cascade,
  body       text        not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists reel_comments_by_reel on reel_comments (reel_id, created_at);
create index if not exists reel_comments_by_author on reel_comments (author_id);
alter table reel_comments enable row level security;
create policy "comments are public" on reel_comments for select using (true);
create policy "comment as yourself" on reel_comments for insert to authenticated
  with check (author_id = (select auth.uid()));

-- Two people may remove a comment: whoever wrote it, and whoever owns the
-- reel it sits under. A shooter's portfolio is their shopfront, so they get
-- the last word on what stays on it.
create policy "delete your own comment or any on your reel" on reel_comments
  for delete to authenticated
  using (
    author_id = (select auth.uid())
    or exists (select 1 from reels r
                where r.id = reel_comments.reel_id and r.owner_id = (select auth.uid()))
  );
revoke update on reel_comments from authenticated, anon;

-- A creator gets a grid tile when work is delivered to them, but the reel
-- belongs to the shooter. The creator can take it off their own grid without
-- touching the shooter's copy of it.
alter table slots
  add column if not exists hidden_from_winner_grid boolean not null default false;

create or replace function hide_booked_tile(p_slot uuid, p_hidden boolean)
returns void language sql volatile set search_path = public
as $$
  update slots set hidden_from_winner_grid = p_hidden
   where id = p_slot and winner_id = (select auth.uid());
$$;
revoke all on function hide_booked_tile(uuid, boolean) from public, anon;
grant execute on function hide_booked_tile(uuid, boolean) to authenticated;
