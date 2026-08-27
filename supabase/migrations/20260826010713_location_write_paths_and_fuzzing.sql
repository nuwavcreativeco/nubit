-- Single place that decides how coarse a public point is.
create or replace function public.fuzz_point(p_lat double precision, p_lng double precision)
returns extensions.geography
language sql
immutable
set search_path to 'public'
as $$
  select extensions.ST_SetSRID(
           extensions.ST_MakePoint(round(p_lng::numeric, 2)::double precision,
                                   round(p_lat::numeric, 2)::double precision),
           4326)::extensions.geography;
$$;

-- Writes the exact point to the restricted table and derives the public one.
create or replace function public.set_slot_location(
  p_slot uuid, p_lat double precision, p_lng double precision, p_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  s  slots%rowtype;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;

  select * into s from slots where id = p_slot for update;
  if not found then raise exception 'no such slot' using errcode = 'P0002'; end if;
  if s.videographer_id <> me then raise exception 'not your slot' using errcode = '42501'; end if;
  if s.status not in ('draft','open') then
    raise exception 'location is locked once a slot settles' using errcode = 'P0001';
  end if;
  if s.status = 'open' and s.bid_count > 0 then
    raise exception 'location cannot move once people have bid' using errcode = 'P0001';
  end if;

  insert into slot_locations (slot_id, geog, address)
  values (p_slot,
          extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)::extensions.geography,
          nullif(trim(p_address), ''))
  on conflict (slot_id) do update
    set geog = excluded.geog, address = excluded.address, updated_at = now();

  update slots set geog_approx = public.fuzz_point(p_lat, p_lng) where id = p_slot;

  return jsonb_build_object('outcome','located');
end $$;

revoke all on function public.set_slot_location(uuid, double precision, double precision, text)
  from public, anon;
grant execute on function public.set_slot_location(uuid, double precision, double precision, text)
  to authenticated;

create or replace function public.set_profile_location(
  p_lat double precision, p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;

  update profiles set geog_approx = public.fuzz_point(p_lat, p_lng) where id = me;
  return jsonb_build_object('outcome','located');
end $$;

revoke all on function public.set_profile_location(double precision, double precision) from public, anon;
grant execute on function public.set_profile_location(double precision, double precision) to authenticated;

-- A direct PostgREST write to profiles.geog_approx gets re-fuzzed, so precise
-- coordinates cannot be smuggled in around the RPC.
create or replace function public.fuzz_profile_point()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if new.geog_approx is not null then
    new.geog_approx := public.fuzz_point(
      extensions.ST_Y(new.geog_approx::extensions.geometry),
      extensions.ST_X(new.geog_approx::extensions.geometry)
    );
  end if;
  return new;
end $$;

drop trigger if exists fuzz_profile_point on public.profiles;
create trigger fuzz_profile_point
  before insert or update of geog_approx on public.profiles
  for each row execute function public.fuzz_profile_point();
