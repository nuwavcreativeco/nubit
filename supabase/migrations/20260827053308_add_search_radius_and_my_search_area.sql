-- Tinder-style radius: the bidder's own search preference, kept on the
-- profile so it follows them across devices and into the native app.
alter table public.profiles
  add column if not exists search_radius_mi int not null default 25;

alter table public.profiles
  drop constraint if exists profiles_search_radius_sane;
alter table public.profiles
  add constraint profiles_search_radius_sane
  check (search_radius_mi between 1 and 500);

-- profiles.geog_approx is a fuzzed geography point and there is no way to
-- read the coordinates back out over PostgREST. slots_near() needs lat/lng,
-- so hand the caller their own saved area and nobody else's.
create or replace function public.my_search_area()
returns table (lat double precision, lng double precision, radius_mi int)
language sql
stable
security definer
set search_path = public
as $$
  select
    extensions.ST_Y(p.geog_approx::extensions.geometry)::double precision,
    extensions.ST_X(p.geog_approx::extensions.geometry)::double precision,
    p.search_radius_mi
  from profiles p
  where p.id = (select auth.uid())
    and p.geog_approx is not null;
$$;

revoke all on function public.my_search_area() from public;
grant execute on function public.my_search_area() to authenticated;
