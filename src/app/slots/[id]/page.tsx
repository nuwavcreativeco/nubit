import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Bid, Slot } from "@/lib/types";
import SlotLive from "@/components/SlotLive";

type BidWithBidder = Bid & { profiles: { display_name: string } | null };

export default async function SlotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: slot } = await supabase
    .from("slots")
    .select("*")
    .eq("id", id)
    .single();

  if (!slot) notFound();
  const typedSlot = slot as Slot;

  const { data: bids } = await supabase
    .from("bids")
    .select("*, profiles(display_name)")
    .eq("slot_id", id)
    .order("amount_cents", { ascending: false });

  const typedBids = (bids ?? []) as BidWithBidder[];

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <Link href="/slots" className="text-sm text-ink-dim transition hover:text-ink">
        &larr; Open slots
      </Link>

      <SlotLive
        slotId={typedSlot.id}
        videographerId={typedSlot.videographer_id}
        title={typedSlot.title}
        shootDate={typedSlot.shoot_date}
        location={typedSlot.location}
        description={typedSlot.description}
        floorRateCents={typedSlot.floor_rate_cents}
        initialStatus={typedSlot.status}
        initialAwardedBidId={typedSlot.awarded_bid_id}
        initialBids={typedBids.map((bid) => ({
          id: bid.id,
          bidderId: bid.bidder_id,
          amountCents: bid.amount_cents,
          createdAt: bid.created_at,
          displayName: bid.profiles?.display_name ?? "Bidder",
        }))}
        userId={user?.id ?? null}
      />
    </main>
  );
}
