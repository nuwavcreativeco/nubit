-- profiles: handles, bio, reel, wider role vocabulary
alter table profiles
  add column if not exists handle   text,
  add column if not exists bio      text,
  add column if not exists reel_url text;

update profiles
set handle = left(regexp_replace(lower(display_name), '[^a-z0-9]+', '_', 'g'), 30)
where handle is null;

alter table profiles
  add constraint profiles_handle_unique unique (handle),
  add constraint profiles_handle_shape check (handle ~ '^[a-z0-9_.]{3,30}$');

alter table profiles alter column handle set not null;

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role = any (array['artist','bidder','videographer','both']));

-- slots: scheduling, auction parameters, denormalised auction state
alter table slots
  add column if not exists starts_at     time not null default '10:00',
  add column if not exists ends_at       time not null default '18:00',
  add column if not exists radius_mi     int  not null default 25,
  add column if not exists step_cents    int  not null default 5000,
  add column if not exists claim_cents   int,
  add column if not exists closes_at     timestamptz,
  add column if not exists reel_url      text,
  add column if not exists poster_url    text,
  add column if not exists delivers      text[] not null default '{}',
  add column if not exists gear          text[] not null default '{}',
  add column if not exists current_cents int,
  add column if not exists leader_id     uuid references profiles(id),
  add column if not exists bid_count     int not null default 0,
  add column if not exists settled_cents int,
  add column if not exists winner_id     uuid references profiles(id),
  add column if not exists settled_at    timestamptz;

-- backfill: ceiling at ~2.4x floor rounded to the step, close 48h before call time
update slots
set claim_cents = round(floor_rate_cents * 2.4 / 5000) * 5000
where claim_cents is null;

update slots
set closes_at = ((shoot_date - 2) + time '18:00') at time zone 'America/Los_Angeles'
where closes_at is null;

alter table slots
  alter column claim_cents set not null,
  alter column closes_at   set not null;

alter table slots
  add constraint slots_sane_ceiling check (claim_cents > floor_rate_cents),
  add constraint slots_sane_window  check (ends_at > starts_at),
  add constraint slots_step_aligns  check (floor_rate_cents % step_cents = 0 and claim_cents % step_cents = 0),
  add constraint slots_step_positive check (step_cents > 0);

-- status: claimed-at-ceiling and won-at-auction settle differently
alter table slots drop constraint if exists slots_status_check;
update slots set status = 'won' where status = 'awarded';
alter table slots add constraint slots_status_check
  check (status = any (array['draft','open','claimed','won','expired','cancelled']));

create index if not exists slots_browse_idx on slots (status, closes_at) where status = 'open';
create index if not exists slots_by_owner   on slots (videographer_id, shoot_date desc);
