# Nubid

Videographers post open shoot slots at a floor day rate. Artists and creators
bid the rate up. Seattle-first MVP.

## Stack

- **Next.js** (App Router, TypeScript, Tailwind CSS)
- **Supabase** — Postgres database, auth, realtime
- Deploys to **Vercel**

## What's in this scaffold

- `/` — landing page
- `/slots` — browse open slots (reads from Supabase)
- `/slots/new` — post a slot (writes to Supabase, requires sign-in)
- `/slots/[id]` — slot detail: bid history, a bid form for signed-in
  non-owners, and award / cancel controls for the videographer who posted
  it. Bids and status changes stream in live via Supabase Realtime — no
  reload needed to watch the price climb or see a slot get awarded
- `/slots/mine` — the slots you've posted, with a live bid count per slot
- `/bids/mine` — the slots you've bid on, with a per-bid status (Winning,
  Outbid, You won, Awarded to another bidder, Cancelled) that updates live
  as rival bids land or a slot gets awarded/cancelled
- `/auth/sign-up`, `/auth/sign-in` — email + password auth via Supabase Auth
- `supabase/schema.sql` — the three core tables (`profiles`, `slots`, `bids`),
  row-level security policies, FK-covering indexes, and a `handle_new_user`
  trigger that creates the matching `profiles` row (role, display name,
  city) on sign-up
- `src/lib/supabase/` — browser + server Supabase clients
- `src/lib/supabase/proxy.ts` + `src/proxy.ts` — refreshes the Auth session
  on every request (Next.js 16 renamed `middleware.ts` to `proxy.ts`)
- `src/app/auth/actions.ts` — sign up / sign in / sign out server actions
- `src/app/slots/[id]/actions.ts` — `placeBid` / `awardBid` server actions.
  Bids must beat the current high (or the floor rate if there are none);
  only the posting videographer can award, and only while a slot is `open`
- `src/app/slots/actions.ts` — also has `cancelSlot` (owner-only, only while
  `open`; needs a two-step confirm in the UI, not a native `confirm()` —
  that blocks silently under browser automation and isn't styleable anyway)
- `src/components/SlotLive.tsx`, `MySlotsLive.tsx`, `MyBidsLive.tsx` — client
  components that own each page's live state and subscribe to Realtime
  channels for `bids` INSERTs and `slots` UPDATEs, filtered to the slot(s)
  each page cares about. `supabase/schema.sql` adds `bids` and `slots` to
  the `supabase_realtime` publication; no extra RLS is needed since
  Postgres Changes only delivers rows a client's existing SELECT policies
  already let it read, and both tables are public-read. `MySlotsLive` and
  `MyBidsLive` build their subscription filter from the slot IDs the page
  loaded with, so a slot posted or bid-on after mount isn't covered until
  the next reload — a non-issue in practice since posting/bidding always
  navigates you to a fresh page load anyway
- `src/lib/types.ts` — shared TypeScript types matching the schema

`bids` has two foreign-key paths to `slots` (`bids.slot_id` and
`slots.awarded_bid_id`), so any PostgREST embed going from `bids` to
`slots` is ambiguous unless you name the relationship explicitly —
`slots!bids_slot_id_fkey(*)`, as used in `/bids/mine`. Embeds from `slots`
to `bids` hit the same ambiguity; `/slots/mine` sidesteps it entirely with
a separate, unembedded query instead.

Signing up asks whether you're a videographer or a bidder. If the Supabase
project has email confirmations turned on (the default for new projects),
new users see a "check your email" message and can't sign in until they
click the confirmation link.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project**

   Go to [supabase.com](https://supabase.com), create a free project, then
   open **SQL Editor** and run the contents of `supabase/schema.sql`.

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

   Visit `http://localhost:3000`. `/slots` will show an empty state until
   there's data (and until sign-in exists, you can add a test row directly
   in the Supabase Table Editor to see it render).

5. **Deploy**

   Push this to a GitHub repo, then import it on [vercel.com](https://vercel.com).
   Add the same two environment variables in the Vercel project settings.

## Next build step

The core loop (post → bid → award/cancel) is now fully built and realtime
end-to-end. What's left is housekeeping: this directory still isn't a git
repo, so there's nothing to push to GitHub or deploy to Vercel yet.
