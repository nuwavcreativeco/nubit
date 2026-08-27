import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isSlotStatus, type Slot } from "@/lib/types";
import MyBidsLive from "@/components/MyBidsLive";

export default async function MyBidsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="text-2xl tracking-tight">Sign in to see your bids</h1>
        <p className="mt-3 text-crew">
          <Link href="/auth/sign-in" className="text-signal underline">
            Sign in
          </Link>{" "}
          to see the slots you&apos;ve bid on.
        </p>
      </main>
    );
  }

  const { data: bids, error } = await supabase
    // bids <-> slots has two FK paths (bids.slot_id and slots.awarded_bid_id),
    // so the relationship must be named explicitly or PostgREST rejects the
    // embed as ambiguous.
    .from("bids")
    .select("max_cents, slots!bids_slot_id_fkey(*)")
    .eq("bidder_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Couldn't load your bids: ${error.message}`);
  }

  // A bidder can raise their max on the same slot more than once, so collapse
  // to one row per slot holding the highest max they committed to.
  const bySlot = new Map<string, { slot: Slot; yourMaxCents: number }>();
  for (const bid of bids ?? []) {
    const slot = bid.slots as Slot | null;
    if (!slot) continue;
    const seen = bySlot.get(slot.id);
    if (!seen || bid.max_cents > seen.yourMaxCents) {
      bySlot.set(slot.id, { slot, yourMaxCents: bid.max_cents });
    }
  }

  const entries = [...bySlot.values()]
    .sort((a, b) => Date.parse(a.slot.closes_at) - Date.parse(b.slot.closes_at))
    .map(({ slot, yourMaxCents }) => ({
      slotId: slot.id,
      slotTitle: slot.title,
      yourMaxCents,
      currentCents: slot.current_cents,
      floorRateCents: slot.floor_rate_cents,
      closesAt: slot.closes_at,
      slotStatus: isSlotStatus(slot.status) ? slot.status : ("open" as const),
      leaderId: slot.leader_id,
      winnerId: slot.winner_id,
    }));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <h1 className="text-3xl tracking-tight">My bids</h1>
      <MyBidsLive userId={user.id} initialEntries={entries} />
    </main>
  );
}
