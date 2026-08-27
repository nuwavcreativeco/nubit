-- NuBid test suite.
--
-- Everything that decides money lives in Postgres, so this is where testing
-- pays best. The whole file runs inside one transaction and deliberately
-- aborts at the end, so it can be run against a live project without leaving
-- a row behind.
--
-- Two things make it a real test rather than a smoke check:
--
--   1. It switches to the `authenticated` role before every assertion that
--      cares about visibility. Running as the owner would bypass RLS
--      entirely and every isolation test would pass for the wrong reason.
--   2. It asserts on failures too — a bid that should be rejected is only
--      correct if it actually raises.
--
-- Run it with:
--   psql "$DATABASE_URL" -f supabase/tests/suite.sql
-- or paste it into the SQL editor. It always ends with an exception; a
-- summary line reading "0 failed" is a pass.

do $suite$
declare
  pass int := 0;
  fail int := 0;
  log  text := '';

  shooter uuid := '00000000-0000-4000-8000-00000000a001';
  artist  uuid := '00000000-0000-4000-8000-00000000a002';
  rival   uuid := '00000000-0000-4000-8000-00000000a003';

  sh_handle text;
  ar_handle text;

  slot_a  uuid;
  slot_b  uuid;
  reel_a  uuid;
  conv    uuid;
  offer_a uuid;

  res     jsonb;
  n       int;
  ts      timestamptz;
  txt     text;
begin
  ---------------------------------------------------------------------------
  -- setup (as owner)
  ---------------------------------------------------------------------------
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data)
  values
    (shooter, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'suite_shooter@test.invalid', 'x', now(), now(), now(),
     '{}'::jsonb, '{"display_name":"Suite Shooter","role":"videographer"}'::jsonb),
    (artist,  '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'suite_artist@test.invalid',  'x', now(), now(), now(),
     '{}'::jsonb, '{"display_name":"Suite Artist","role":"bidder"}'::jsonb),
    (rival,   '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'suite_rival@test.invalid',   'x', now(), now(), now(),
     '{}'::jsonb, '{"display_name":"Suite Rival","role":"bidder"}'::jsonb);

  select handle into sh_handle from profiles where id = shooter;
  select handle into ar_handle from profiles where id = artist;

  if sh_handle is null or ar_handle is null then
    raise exception 'setup failed: handle_new_user did not create profiles';
  end if;

  -- a reel on the shooter's grid, and two open days
  insert into reels (id, owner_id, video_url, poster_url, caption, aspect, duration_seconds)
  values (gen_random_uuid(), shooter, 'https://x/v.mp4', 'https://x/p.jpg',
          'suite reel', '9:16', 42)
  returning id into reel_a;

  insert into slots (videographer_id, title, location, shoot_date,
                     floor_rate_cents, step_cents, claim_cents, closes_at,
                     status, reel_id)
  values (shooter, 'Suite day A', 'A studio', current_date + 14,
          20000, 5000, 100000, now() + interval '2 days', 'open', reel_a)
  returning id into slot_a;

  -- a day that closes inside the anti-snipe window
  insert into slots (videographer_id, title, location, shoot_date,
                     floor_rate_cents, step_cents, claim_cents, closes_at, status)
  values (shooter, 'Suite day B', 'A studio', current_date + 14,
          20000, 5000, 100000, now() + interval '2 minutes', 'open')
  returning id into slot_b;

  ---------------------------------------------------------------------------
  -- AUCTION MATH
  ---------------------------------------------------------------------------

  -- 1. the opening bid sits at the floor, not at the bidder's ceiling
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', artist, 'role', 'authenticated')::text, true);

  res := place_bid(slot_a, 50000);
  if (res->>'price_cents')::int = 20000 and res->>'outcome' = 'leading' then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL opening bid rests on the floor -> ' || res::text;
  end if;

  -- 2. a rival below the leader's ceiling loses, and the price steps to
  --    one increment above the rival's max (proxy bidding)
  perform set_config('request.jwt.claims',
    json_build_object('sub', rival, 'role', 'authenticated')::text, true);

  res := place_bid(slot_a, 35000);
  if res->>'outcome' = 'outbid' and (res->>'price_cents')::int = 40000 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL proxy price after a losing challenge -> ' || res::text;
  end if;

  -- 3. a bid that is not step-aligned must be refused
  begin
    res := place_bid(slot_a, 41234);
    fail := fail + 1;
    log := log || E'\n  FAIL an unaligned bid was accepted';
  exception when others then
    pass := pass + 1;
  end;

  -- 4. THE REGRESSION: a minimum bid on an already-bid-up slot must not
  --    walk current_cents backwards. There is a migration devoted to this.
  begin
    res := place_bid(slot_a, 20000);
    -- if it is somehow accepted, the price must still not have dropped
    select current_cents into n from slots where id = slot_a;
    if n >= 40000 then
      pass := pass + 1;
    else
      fail := fail + 1;
      log := log || E'\n  FAIL price walked backwards to ' || n;
    end if;
  exception when others then
    pass := pass + 1;  -- refusing it outright is the correct behaviour
  end;

  -- 5. a videographer cannot bid on their own day
  perform set_config('request.jwt.claims',
    json_build_object('sub', shooter, 'role', 'authenticated')::text, true);
  begin
    res := place_bid(slot_a, 60000);
    fail := fail + 1;
    log := log || E'\n  FAIL the shooter bid on their own day';
  exception when others then
    pass := pass + 1;
  end;

  -- 6. anti-snipe: a bid inside the last five minutes pushes the close out
  perform set_config('request.jwt.claims',
    json_build_object('sub', artist, 'role', 'authenticated')::text, true);
  select closes_at into ts from slots where id = slot_b;
  res := place_bid(slot_b, 20000);
  select closes_at into ts from slots where id = slot_b;
  if ts > now() + interval '4 minutes' and (res->>'extended')::boolean then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL anti-snipe did not extend the clock';
  end if;

  ---------------------------------------------------------------------------
  -- RLS ISOLATION  (the quiet, catastrophic kind of bug)
  ---------------------------------------------------------------------------

  -- 7. one bidder must not see another bidder's bids
  perform set_config('request.jwt.claims',
    json_build_object('sub', artist, 'role', 'authenticated')::text, true);
  select count(*) into n from bids where bidder_id = rival;
  if n = 0 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL a bidder can read ' || n || ' of a rival''s bids';
  end if;

  -- 8. the masked history hides rival names while the auction is live
  select bidder into txt from slot_bid_history(slot_a)
   where is_you = false limit 1;
  if txt is null or txt like '%*%' then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL a rival name leaked unmasked: ' || txt;
  end if;

  ---------------------------------------------------------------------------
  -- FOLLOWS AND THE BELL
  ---------------------------------------------------------------------------

  -- 9. following, then posting, rings exactly the follower
  execute 'reset role';
  insert into follows (follower_id, followee_id) values (artist, shooter);

  insert into slots (videographer_id, title, location, shoot_date,
                     floor_rate_cents, step_cents, claim_cents, closes_at, status)
  values (shooter, 'Suite day C', 'A studio', current_date + 20,
          30000, 5000, 90000, now() + interval '3 days', 'open')
  returning id into slot_b;

  select count(*) into n from notifications
   where kind = 'followed_posted' and slot_id = slot_b;
  if n = 1 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL the bell rang ' || n || ' times, expected 1';
  end if;

  -- 10. ...and it reached the follower, not the shooter
  select count(*) into n from notifications
   where kind = 'followed_posted' and slot_id = slot_b and user_id = artist;
  if n = 1 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL the bell did not reach the follower';
  end if;

  ---------------------------------------------------------------------------
  -- MESSAGING AND THE SPLIT INBOX
  ---------------------------------------------------------------------------

  -- 11. a thread with someone you follow lands in primary
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', artist, 'role', 'authenticated')::text, true);

  conv := start_conversation(shooter, null);
  insert into messages (conversation_id, sender_id, body)
  values (conv, artist, 'is this day still open?');

  select count(*) into n from my_inbox('primary');
  if n = 1 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL followed thread not in primary (got ' || n || ')';
  end if;

  -- 12. a stranger's thread lands in requests, not primary
  perform set_config('request.jwt.claims',
    json_build_object('sub', rival, 'role', 'authenticated')::text, true);
  perform start_conversation(artist, null);
  insert into messages (conversation_id, sender_id, body)
  select c.id, rival, 'cold outreach'
    from conversations c
    join conversation_participants a on a.conversation_id = c.id and a.user_id = rival
    join conversation_participants b on b.conversation_id = c.id and b.user_id = artist
   limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', artist, 'role', 'authenticated')::text, true);
  select count(*) into n from my_inbox('requests');
  if n = 1 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL cold thread not in requests (got ' || n || ')';
  end if;

  -- 13. a third party cannot read either thread
  perform set_config('request.jwt.claims',
    json_build_object('sub', shooter, 'role', 'authenticated')::text, true);
  select count(*) into n from messages where body = 'cold outreach';
  if n = 0 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL a third party read someone else''s message';
  end if;

  ---------------------------------------------------------------------------
  -- DIRECT OFFERS
  ---------------------------------------------------------------------------

  -- 14. an offer accepted books a settled slot on the auction's own rails
  offer_a := send_offer(
    p_to => artist, p_title => 'Suite offer', p_location => 'A studio',
    p_shoot_date => current_date + 21, p_price_cents => 150000,
    p_expires_at => now() + interval '2 days', p_reel => reel_a);

  perform set_config('request.jwt.claims',
    json_build_object('sub', artist, 'role', 'authenticated')::text, true);
  res := respond_to_offer(offer_a, true);

  select count(*) into n from slots
   where id = (res->>'slot_id')::uuid
     and status = 'won' and source = 'offer'
     and winner_id = artist and settled_cents = 150000;
  if n = 1 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL accepted offer did not book a settled slot -> ' || res::text;
  end if;

  -- 15. the same offer cannot be accepted twice
  begin
    perform respond_to_offer(offer_a, true);
    fail := fail + 1;
    log := log || E'\n  FAIL an offer was accepted twice';
  exception when others then
    pass := pass + 1;
  end;

  -- 16. a stranger cannot accept an offer addressed to someone else
  perform set_config('request.jwt.claims',
    json_build_object('sub', rival, 'role', 'authenticated')::text, true);
  select count(*) into n from offers where id = offer_a;
  if n = 0 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL a stranger can read an offer between two other people';
  end if;

  ---------------------------------------------------------------------------
  -- DELIVERY AND THE PROFILE GRID
  ---------------------------------------------------------------------------

  -- 17. the creator's grid is empty until the work is delivered
  execute 'reset role';
  select count(*) into n from profile_grid(ar_handle);
  if n = 0 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL creator grid had ' || n || ' tiles before delivery';
  end if;

  -- 18. delivering puts a tile on the creator's grid, credited to the shooter
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', shooter, 'role', 'authenticated')::text, true);
  perform deliver_reel((select slot_id from offers where id = offer_a), reel_a);

  execute 'reset role';
  select count(*) into n from profile_grid(ar_handle) where source = 'booked';
  select credit_name into txt from profile_grid(ar_handle) limit 1;
  if n = 1 and txt = 'Suite Shooter' then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL delivered tile missing or miscredited (n=' || n
                || ', credit=' || coalesce(txt, 'null') || ')';
  end if;

  -- 19. the shooter's own grid still shows the reel as their own work
  select count(*) into n from profile_grid(sh_handle) where source = 'own';
  if n = 1 then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL shooter grid lost its own reel';
  end if;

  ---------------------------------------------------------------------------
  -- SETTLEMENT
  ---------------------------------------------------------------------------

  -- 20. close_due_slots settles a past-due day and names a winner
  update slots set closes_at = now() - interval '1 minute' where id = slot_a;
  perform close_due_slots();

  select status into txt from slots where id = slot_a;
  if txt = 'won' then
    pass := pass + 1;
  else
    fail := fail + 1;
    log := log || E'\n  FAIL a due slot settled as ' || txt || ', expected won';
  end if;

  ---------------------------------------------------------------------------
  raise exception E'SUITE RESULT: % passed, % failed%',
    pass, fail, case when fail = 0 then ' — all green' else log end;
end
$suite$;
