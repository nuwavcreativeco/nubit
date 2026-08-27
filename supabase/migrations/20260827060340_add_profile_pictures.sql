-- Both sides of the market get a face: shooters and creators alike.
alter table profiles
  add column if not exists avatar_url text;

-- Profiles are already publicly readable; make sure the write path stays
-- self-only for the new column by relying on the existing profiles policies.
comment on column profiles.avatar_url is
  'Public avatar. Storage-backed URL; null renders the initials fallback.';
