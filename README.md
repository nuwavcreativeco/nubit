# NuBid

Videographers post open shoot slots at a floor day rate. Artists and creators
bid the rate up until the clock runs out — or claim the day outright at the
posted claim price. Open worldwide.

## Stack

- **Next.js** (App Router, TypeScript, Tailwind CSS)
- **Supabase** — Postgres database, auth, realtime, pg_cron
- Deploys to **Vercel**

## How the auction works

Everything that decides money lives in Postgres, not in the app:

- **`place_bid(slot, max_cents)`** — a bid is a *ceiling*, not a price. The
  function takes a row lock, works out the proxy price (one step above the
  rival max, capped at your own), enforces the step / floor / claim bounds,
  and returns `leading`, `outbid`, or `ceiling_hit`. A bid inside the last
  five minutes pushes `closes_at` out another five.
- **`claim_slot(slot)`** — buy-it-now at `claim_cents`, ends the auction.
- **`close_due_slots()`** — settles everything past `closes_at` to `won`
  (there was a leader) or `expired` (there wasn't). Runs every minute on
  pg_cron; there is no manual award step.
- **`slot_bid_history(slot)`** — the public ticker. Bidder names come back
  masked (`A** T*****`) and amounts never come back at all until the slot
  settles.

Clients have no INSERT on `bids` and can only SELECT their own rows, so the
RPCs are the only way in. Slot rows carry `current_cents`, `bid_count`,
`leader_id` and `winner_id` denormalised, which is what every list page reads
and what Realtime broadcasts.

## What's in here

- `/` — landing page
- `/slots` — open slots, soonest to close first, with live countdowns
- `/slots/new` — post a slot: floor, step, claim price, close time, call
  time, deliverables, gear
- `/slots/[id]` — slot detail: countdown, current price, proxy bid form,
  claim button, masked bid history, cancel control for the owner
- `/slots/mine` — the slots you've posted, live price and bid count
- `/bids/mine` — the slots you've bid on, one row per slot with your max and
  a live Leading / Outbid / You won status
- `/auth/sign-up`, `/auth/sign-in` — email + password auth via Supabase Auth
- `supabase/migrations/` — the schema, in the exact order it was applied
- `src/lib/database.types.ts` — generated from the live database
- `src/lib/supabase/` — browser + server Supabase clients, typed against it
- `src/lib/supabase/proxy.ts` + `src/proxy.ts` — refreshes the Auth session
  on every request (Next.js 16 renamed `middleware.ts` to `proxy.ts`)

### Two things worth knowing before you touch the data layer

**Regenerate the types after every migration.** The app is typed against
`src/lib/database.types.ts`; if that file is stale, a renamed column breaks
the deployed site instead of the build.

```bash
npx supabase gen types typescript --project-id ekhmpsamdiwlgnajxfpz > src/lib/database.types.ts
```

**Realtime on `bids` is nearly useless now.** Postgres Changes only delivers
rows a client's SELECT policies already allow, and the `bids` policy is
`bidder_id = auth.uid()` — so a subscription on `bids` never sees a rival's
bid. Every live page subscribes to `slots` UPDATEs instead and re-fetches the
masked history from the RPC.

`bids` has two foreign-key paths to `slots` (`bids.slot_id` and
`slots.awarded_bid_id`), so any PostgREST embed from `bids` to `slots` needs
the relationship named explicitly — `slots!bids_slot_id_fkey(*)`, as used in
`/bids/mine`.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project**

   Run the files in `supabase/migrations/` in filename order in the SQL
   Editor. The live project already has every one of them applied — the
   folder is there so a fresh project can be rebuilt from scratch and so
   schema changes stop living only in the cloud.

3. **Add your environment variables**

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   from your Supabase project's **Settings → API** page.

4. **Run it locally**

   ```bash
   npm run dev
   ```

5. **Deploy** — pushing to `main` deploys to Vercel. The same two
   environment variables need to be set in the Vercel project settings.

## A test database

`nubid-test` (project ref `iatotzexniivpppwyfrm`) is an empty second Supabase
project on the free tier — $0/month. Branching would have been the natural
choice, but it needs the Pro plan; a second free project gives the same
isolation.

It is deliberately empty, because filling it is the test. These two commands
apply all 42 migrations in filename order, which is the only real proof that
`supabase/migrations/` can rebuild the schema from nothing:

```bash
npx supabase link --project-ref iatotzexniivpppwyfrm
npx supabase db push
```

Both need credentials this repo doesn't hold — `link` opens a browser login,
and `db push` asks for that project's database password. Once it's populated,
point `.env.local` at the test project to exercise the app without touching
production, and run the suite below against it.

## Testing

`supabase/tests/suite.sql` is the database test suite — 20 assertions over the
parts that decide money and privacy. It runs inside a single transaction and
deliberately aborts at the end, so it can be run against the live project
without leaving a row behind. A summary reading `0 failed` is a pass.

```bash
psql "$DATABASE_URL" -f supabase/tests/suite.sql
```

Two things make it a real test rather than a smoke check. It switches to the
`authenticated` role before every visibility assertion — running as the owner
would bypass RLS and every isolation test would pass for the wrong reason. And
it asserts on refusals too: a bid that should be rejected only counts if it
actually raises.

It covers proxy-bid pricing, step alignment, the price-walks-backwards
regression, self-bidding, the anti-snipe extension, bid isolation between
rivals, masked bid history, follower bell fan-out, the primary/requests inbox
split, third-party message isolation, offer accept/double-accept/isolation,
delivery crediting the right grid, and settlement.

What it does not cover: anything in a browser. Reel upload, the realtime bell,
and the offer UI need a signed-in session and a real file — see the launch
notes below.

## Browser tests

Playwright, in `e2e/`. Four projects:

```bash
npm run test:e2e:public   # no accounts needed
npm run test:e2e          # everything, needs .env.test
```

`public` covers what a stranger sees — the landing page, the board card's
anatomy (including that REC really is red and the primary button is
black-on-cyan rather than the site's 1.9:1 white), the aspect filter, a slot
page, and that the signed-out private routes ask for a sign in instead of
throwing a 500. **These six pass today.**

The rest need two throwaway accounts on the test project. Copy
`.env.test.example` to `.env.test` and fill it in; `playwright.config.ts`
reads it automatically. `auth.setup.ts` signs both in through the real form
and saves the cookies, so the login path is covered by the act of setting up
— seeding cookies directly would mean reverse-engineering `@supabase/ssr`'s
chunked format and getting a suite that passes while sign-in is broken.

- `upload.shooter.spec.ts` — a vertical clip lands tagged 9:16 (proving the
  aspect comes from the pixels), a large file reports progress, an
  undecodable file asks for the shape instead of silently defaulting to 16:9,
  and an oversized file is refused before anything uploads.
- `follow.both.spec.ts` — follow, then post from the other session, and the
  bell rings on the first with the right day.
- `offer.both.spec.ts` — a cold message lands in requests and moves to primary
  once followed; an offer sent, accepted, and booked as a real settled day.

There is no video fixture in the repo. `e2e/video.ts` records one in the
browser with canvas + MediaRecorder, so the clip is genuinely decodable and
the uploader's probe has something real to read.

**Point these at the test project, never production.** They post days, send
offers and book shoots for real; unlike the SQL suite there is no rollback.

## Next build steps

The phone design system in `Nubid bidding platform.zip` (tokens, six screens,
component sheets, 1024px app icons) has not been applied yet — the app still
wears the placeholder brass/teal theme. In rough order:

1. Adopt `assets/nubid-tokens.css` — dark ground `#1d1f20`, Barlow Condensed,
   zero radius, `#94bce3` accent — and rebuild the pages mobile-first against
   the six designed screens.
2. Bottom tab bar (SLOTS / MY BIDS / POST / YOU) and the **YOU** profile
   screen, which doesn't exist yet.
3. Feed filters (All / Closing / No bids / ≤$600) and the outbid card.
4. `manifest.json` + the 1024 icons so it installs to the home screen.
5. Reels: a Storage bucket and an upload flow — `slots.reel_url` /
   `poster_url` are still plain text columns with nothing writing to them.
6. Reviews UI — the `reviews` table and `videographer_stats` view are live
   and the detail page reads the rating, but nothing writes a review yet.
7. Then Expo, sharing this Supabase backend, for push notifications on
   outbid — the one thing a web app can't do well.
