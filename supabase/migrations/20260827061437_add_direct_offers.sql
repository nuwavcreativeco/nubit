-- Direct offers keep hand-made deals on the ledger.
--
-- A shooter browses a creator's grid, likes the work, and offers a specific
-- day at a specific price. Accepting books it through the SAME rails as a won
-- auction -- a settled slot with a winner -- so reviews, no-show reports and
-- videographer_stats all keep working. A deal closed in a DM would produce
-- none of that.
alter table slots
  add column if not exists source text not null default 'auction'
    check (source in ('auction', 'offer'));

comment on column slots.source is
  'auction = won or claimed on the board; offer = booked from a direct offer.';

create table if not exists offers (
  id              uuid        primary key default gen_random_uuid(),
  from_id         uuid        not null references profiles(id) on delete cascade,
  to_id           uuid        not null references profiles(id) on delete cascade,
  -- the piece of work the offer is modelled on, for context in the thread
  reel_id         uuid        references reels(id) on delete set null,
  title           text        not null,
  location        text        not null,
  area_label      text,
  shoot_date      date        not null,
  starts_at       time        not null default '10:00',
  ends_at         time        not null default '18:00',
  -- whole dollars: a direct booking has no bid step to align to
  price_cents     int         not null
                    check (price_cents > 0 and price_cents % 100 = 0),
  note            text,
  expires_at      timestamptz not null,
  status          text        not null default 'pending'
                    check (status in ('pending','accepted','declined','withdrawn','expired')),
  conversation_id uuid        references conversations(id) on delete set null,
  slot_id         uuid        references slots(id)         on delete set null,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  constraint offers_not_self  check (from_id <> to_id),
  constraint offers_sane_window check (ends_at > starts_at)
);

create index if not exists offers_to_idx   on offers (to_id,   created_at desc);
create index if not exists offers_from_idx on offers (from_id, created_at desc);
create index if not exists offers_reel_idx on offers (reel_id);
create index if not exists offers_slot_idx on offers (slot_id);
create index if not exists offers_conversation_idx on offers (conversation_id);

alter table offers enable row level security;

-- Only the two people involved ever see it.
create policy "read offers you are part of" on offers
  for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

-- Every write goes through the RPCs below.
revoke insert, update, delete on offers from authenticated, anon;

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind = any (array[
    'won','sold','lost','outbid','expired','claimed','sold_claim',
    'cancelled_by_videographer','cancelled_by_winner',
    'followed_posted','message',
    'offer_received','offer_accepted','offer_declined','offer_withdrawn'
  ]));

-- Send an offer. Lands in the message thread so it reads as reaching out,
-- and rings the recipient.
create or replace function send_offer(
  p_to         uuid,
  p_title      text,
  p_location   text,
  p_shoot_date date,
  p_price_cents int,
  p_expires_at timestamptz,
  p_reel       uuid default null,
  p_note       text default null,
  p_area_label text default null,
  p_starts_at  time default '10:00',
  p_ends_at    time default '18:00'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me    uuid := (select auth.uid());
  conv  uuid;
  v_id  uuid;
begin
  if me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if p_to = me then
    raise exception 'cannot offer to yourself' using errcode = '22023';
  end if;
  if p_expires_at <= now() then
    raise exception 'expiry must be in the future' using errcode = '22023';
  end if;
  if p_shoot_date < current_date then
    raise exception 'shoot date must not be in the past' using errcode = '22023';
  end if;
  if p_reel is not null
     and not exists (select 1 from reels where id = p_reel and owner_id = me) then
    raise exception 'that reel is not yours' using errcode = '42501';
  end if;

  conv := start_conversation(p_to, null);

  insert into offers (from_id, to_id, reel_id, title, location, area_label,
                      shoot_date, starts_at, ends_at, price_cents, note,
                      expires_at, conversation_id)
  values (me, p_to, p_reel, p_title, p_location, p_area_label,
          p_shoot_date, p_starts_at, p_ends_at, p_price_cents, p_note,
          p_expires_at, conv)
  returning id into v_id;

  insert into notifications (user_id, kind, payload)
  select p_to, 'offer_received',
         jsonb_build_object(
           'offer_id',        v_id,
           'conversation_id', conv,
           'from_id',         me,
           'from_name',       p.display_name,
           'handle',          p.handle,
           'title',           p_title,
           'shoot_date',      p_shoot_date,
           'price_cents',     p_price_cents,
           'expires_at',      p_expires_at
         )
  from profiles p where p.id = me;

  return v_id;
end;
$$;

revoke all on function send_offer(uuid,text,text,date,int,timestamptz,uuid,text,text,time,time)
  from public, anon;
grant execute on function send_offer(uuid,text,text,date,int,timestamptz,uuid,text,text,time,time)
  to authenticated;

-- Accept or decline. Accepting writes a settled slot; the guard trigger stands
-- down for a definer because it only polices the 'authenticated' role.
create or replace function respond_to_offer(p_offer uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := (select auth.uid());
  o    offers;
  v_slot uuid;
begin
  select * into o from offers where id = p_offer for update;

  if not found then
    raise exception 'no such offer' using errcode = '22023';
  end if;
  if o.to_id <> me then
    raise exception 'that offer is not addressed to you' using errcode = '42501';
  end if;
  if o.status <> 'pending' then
    raise exception 'this offer is already %', o.status using errcode = '22023';
  end if;
  if o.expires_at <= now() then
    update offers set status = 'expired', decided_at = now() where id = o.id;
    return jsonb_build_object('outcome', 'expired');
  end if;

  if not p_accept then
    update offers set status = 'declined', decided_at = now() where id = o.id;

    insert into notifications (user_id, kind, payload)
    select o.from_id, 'offer_declined',
           jsonb_build_object('offer_id', o.id, 'by_id', me,
                              'by_name', p.display_name, 'title', o.title)
    from profiles p where p.id = me;

    return jsonb_build_object('outcome', 'declined');
  end if;

  -- Booked. floor/claim/step carry no meaning for a hand-made deal, but the
  -- table's auction constraints still have to hold, so they are set to the
  -- agreed price on a one-dollar step.
  insert into slots (
    videographer_id, title, location, area_label, shoot_date,
    starts_at, ends_at, floor_rate_cents, step_cents, claim_cents,
    closes_at, status, winner_id, settled_cents, settled_at,
    reel_id, source
  )
  values (
    o.from_id, o.title, o.location, o.area_label, o.shoot_date,
    o.starts_at, o.ends_at, o.price_cents, 100, o.price_cents + 100,
    now(), 'won', o.to_id, o.price_cents, now(),
    o.reel_id, 'offer'
  )
  returning id into v_slot;

  update offers
     set status = 'accepted', decided_at = now(), slot_id = v_slot
   where id = o.id;

  insert into notifications (user_id, kind, slot_id, payload)
  select o.from_id, 'offer_accepted', v_slot,
         jsonb_build_object('offer_id', o.id, 'slot_id', v_slot, 'by_id', me,
                            'by_name', p.display_name, 'title', o.title,
                            'price_cents', o.price_cents)
  from profiles p where p.id = me;

  return jsonb_build_object('outcome', 'accepted', 'slot_id', v_slot,
                            'price_cents', o.price_cents);
end;
$$;

revoke all on function respond_to_offer(uuid,boolean) from public, anon;
grant execute on function respond_to_offer(uuid,boolean) to authenticated;

create or replace function withdraw_offer(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o  offers;
begin
  select * into o from offers where id = p_offer for update;
  if not found then
    raise exception 'no such offer' using errcode = '22023';
  end if;
  if o.from_id <> me then
    raise exception 'that offer is not yours' using errcode = '42501';
  end if;
  if o.status <> 'pending' then
    raise exception 'this offer is already %', o.status using errcode = '22023';
  end if;

  update offers set status = 'withdrawn', decided_at = now() where id = o.id;

  insert into notifications (user_id, kind, payload)
  values (o.to_id, 'offer_withdrawn',
          jsonb_build_object('offer_id', o.id, 'title', o.title));
end;
$$;

revoke all on function withdraw_offer(uuid) from public, anon;
grant execute on function withdraw_offer(uuid) to authenticated;

-- Both sides of the offer book. Pending offers past their expiry read as
-- 'expired' without needing a cron to sweep them.
create or replace function my_offers(p_box text default 'received')
returns table (
  id           uuid,
  status       text,
  title        text,
  location     text,
  area_label   text,
  shoot_date   date,
  starts_at    time,
  ends_at      time,
  price_cents  int,
  note         text,
  expires_at   timestamptz,
  created_at   timestamptz,
  decided_at   timestamptz,
  slot_id      uuid,
  conversation_id uuid,
  reel_id      uuid,
  reel_poster_url text,
  other_id     uuid,
  other_name   text,
  other_handle text,
  other_avatar_url text
)
language sql
stable
set search_path = public
as $$
  select
    o.id,
    case when o.status = 'pending' and o.expires_at <= now()
         then 'expired' else o.status end,
    o.title, o.location, o.area_label, o.shoot_date, o.starts_at, o.ends_at,
    o.price_cents, o.note, o.expires_at, o.created_at, o.decided_at,
    o.slot_id, o.conversation_id, o.reel_id, r.poster_url,
    p.id, p.display_name, p.handle, p.avatar_url
  from offers o
  join profiles p
    on p.id = case when p_box = 'sent' then o.to_id else o.from_id end
  left join reels r on r.id = o.reel_id
  where case when p_box = 'sent'
             then o.from_id = (select auth.uid())
             else o.to_id   = (select auth.uid())
        end
  order by o.created_at desc;
$$;

revoke all on function my_offers(text) from public, anon;
grant execute on function my_offers(text) to authenticated;
