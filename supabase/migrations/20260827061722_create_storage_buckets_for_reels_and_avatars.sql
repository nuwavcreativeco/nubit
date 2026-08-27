-- Nothing could be uploaded before this: reels.video_url, reels.poster_url
-- and profiles.avatar_url were text columns pointing at a bucket that did
-- not exist.
--
-- Both buckets are public-read (a portfolio and a face are public by
-- definition) and writable only inside a folder named for the owner's uid,
-- which is what the policies below pin.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('reels', 'reels', true, 524288000, array[
     'video/mp4','video/quicktime','video/webm',
     'image/jpeg','image/png','image/webp'
   ]),
  ('avatars', 'avatars', true, 5242880, array[
     'image/jpeg','image/png','image/webp'
   ])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone. These are portfolios.
drop policy if exists "reels are publicly readable" on storage.objects;
create policy "reels are publicly readable" on storage.objects
  for select using (bucket_id = 'reels');

drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable" on storage.objects
  for select using (bucket_id = 'avatars');

-- Write: only into your own uid folder, e.g. reels/<uid>/clip.mp4
drop policy if exists "upload your own reels" on storage.objects;
create policy "upload your own reels" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "replace your own reels" on storage.objects;
create policy "replace your own reels" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "delete your own reels" on storage.objects;
create policy "delete your own reels" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reels'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "upload your own avatar" on storage.objects;
create policy "upload your own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "replace your own avatar" on storage.objects;
create policy "replace your own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "delete your own avatar" on storage.objects;
create policy "delete your own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
