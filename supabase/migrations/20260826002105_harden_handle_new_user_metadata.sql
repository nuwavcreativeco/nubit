create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  base      text;
  candidate text;
  v_role    text;
  v_name    text;
  n         int := 0;
begin
  -- Client-supplied signup metadata is untrusted. An unrecognised role
  -- used to violate profiles_role_check and fail the whole signup.
  v_role := lower(nullif(trim(new.raw_user_meta_data->>'role'), ''));
  if v_role is null or v_role not in ('artist', 'bidder', 'videographer', 'both') then
    v_role := 'bidder';
  end if;

  v_name := nullif(trim(coalesce(
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  )), '');
  v_name := left(coalesce(v_name, 'Nubid user'), 60);

  base := lower(coalesce(
    new.raw_user_meta_data->>'handle',
    new.raw_user_meta_data->>'display_name',
    split_part(new.email, '@', 1)
  ));
  base := regexp_replace(base, '[^a-z0-9_.]+', '_', 'g');
  base := regexp_replace(base, '^[_.]+', '');
  base := regexp_replace(base, '[_.]+$', '');

  if base = '' then base := 'nubid'; end if;
  if length(base) < 3 then base := base || '_nb'; end if;
  base := left(base, 26);

  candidate := base;
  while exists (select 1 from public.profiles p where p.handle = candidate) loop
    n := n + 1;
    candidate := base || '_' || n::text;
  end loop;

  insert into public.profiles (id, role, display_name, city, handle)
  values (
    new.id,
    v_role,
    v_name,
    left(nullif(trim(new.raw_user_meta_data->>'city'), ''), 80),
    candidate
  );
  return new;
end;
$function$;
