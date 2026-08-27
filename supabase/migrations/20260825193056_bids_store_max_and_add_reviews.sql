-- a bid is a ceiling, not a price
alter table bids rename column amount_cents to max_cents;
alter table bids rename constraint bids_amount_cents_check to bids_max_cents_check;

create index if not exists bids_slot_idx on bids (slot_id, max_cents desc, created_at asc);

-- backfill auction state from bids already on file
with lead as (
  select distinct on (slot_id)
    slot_id, bidder_id, max_cents
  from bids
  order by slot_id, max_cents desc, created_at asc
),
counts as (
  select slot_id, count(*) as n from bids group by slot_id
)
update slots s
set leader_id     = lead.bidder_id,
    bid_count     = counts.n,
    current_cents = case when counts.n = 1 then s.floor_rate_cents else least(lead.max_cents, s.claim_cents) end
from lead join counts on counts.slot_id = lead.slot_id
where s.id = lead.slot_id;

create table if not exists reviews (
  id          bigserial primary key,
  slot_id     uuid not null references slots(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  subject_id  uuid not null references profiles(id) on delete cascade,
  rating      numeric(2,1) not null check (rating between 1.0 and 5.0),
  body        text not null check (length(body) between 10 and 800),
  created_at  timestamptz not null default now(),
  unique (slot_id, author_id)
);

create index if not exists reviews_subject_idx on reviews (subject_id, created_at desc);
alter table reviews enable row level security;
