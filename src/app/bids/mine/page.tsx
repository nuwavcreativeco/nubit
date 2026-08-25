import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Bid, Slot } from "@/lib/types";
import MyBidsLive from "@/components/MyBidsLive";

type BidWithSlot = Bid & { slots: Slot | null };

export default async function MyBidsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="font-display text-2xl">Sign in to see your bids</h1>
        <p className="mt-3 text-ink-dim">
          <Link href="/auth/sign-in" className="text-brass underline">
            Sign in
          </Link>{" "}
          to see the slots you've bid on.
        </p>
      </main>
    );
  }

  const { data: bids, error: bidsError } = await supabase
    .from("bids")
    // bids <-> slots has two FK paths (bids.slot_id and slots.awarded_bid_id),
    // so the relationship must be named explicitly or PostgREST rejects the
    // embed as ambiguous.
    .select("*, slots!bids_slot_id_fkey(*)")
    .eq("bidder_id", user.id)
    .order("created_at", { ascending: false });

  if (bidsError) {
    throw new Error(`Couldn't load your bids: ${bidsError.message}`);
  }

  const typedBids = (bids ?? []) as BidWithSlot[];
  const bidsWithSlot = typedBids.filter(
    (b): b is BidWithSlot & { slots: Slot } => b.slots !== null
  );

  const slotIds = [...new Set(bidsWithSlot.map((b) => b.slots.id))];
  const { data: rivalBids } = slotIds.length
    ? await supabase.from("bids").select("slot_id, amount_cents").in("slot_id", slotIds)
    : { data: [] };

  const highestBySlot: Record<string, number> = {};
  for (const b of rivalBids ?? []) {
    if (!highestBySlot[b.slot_id] || b.amount_cents > highestBySlot[b.slot_id]) {
      highestBySlot[b.slot_id] = b.amount_cents;
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <h1 className="font-display text-3xl">My bids</h1>

      <MyBidsLive
        userId={user.id}
        initialHighestBySlot={highestBySlot}
        initialBids={bidsWithSlot.map((bid) => ({
          id: bid.id,
          amountCents: bid.amount_cents,
          slotId: bid.slots.id,
          slotTitle: bid.slots.title,
          slotStatus: bid.slots.status,
          awardedBidId: bid.slots.awarded_bid_id,
          floorRateCents: bid.slots.floor_rate_cents,
        }))}
      />
    </main>
  );
}
