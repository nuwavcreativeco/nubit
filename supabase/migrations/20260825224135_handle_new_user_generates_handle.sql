-- profiles.handle is NOT NULL with no default, but handle_new_user() never
-- set it, so every sign-up failed on a not-null violation. Derive a handle
-- that satisfies the ^[a-z0-9_.]{3,30}$ check and the unique index.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base      text;
  candidate text;
  n         int := 0;
begin
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
    coalesce(new.raw_user_meta_data->>'role', 'bidder'),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'city',
    candidate
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;
