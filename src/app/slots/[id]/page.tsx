import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSlotStatus } from "@/lib/types";
import SlotLive, { type HistoryEntry } from "@/components/SlotLive";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: videographer }, { data: stats }, { data: history }, { data: yourBid }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", slot.videographer_id)
        .single(),
      supabase
        .from("videographer_stats")
        .select("rating, review_count")
        .eq("id", slot.videographer_id)
        .maybeSingle(),
      supabase.rpc("slot_bid_history", { p_slot: id }),
      user
        ? supabase
            .from("bids")
            .select("max_cents")
            .eq("slot_id", id)
            .eq("bidder_id", user.id)
            .order("max_cents", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const entries: HistoryEntry[] = (history ?? []).map((row) => ({
    bidAt: row.bid_at,
    bidder: row.bidder,
    isYou: row.is_you,
  }));

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <Link href="/slots" className="text-sm text-crew transition hover:text-key">
        &larr; Open slots
      </Link>

      <SlotLive
        slotId={slot.id}
        videographerId={slot.videographer_id}
        videographerName={videographer?.display_name ?? "Videographer"}
        rating={stats?.rating ?? null}
        reviewCount={stats?.review_count ?? null}
        title={slot.title}
        shootDate={slot.shoot_date}
        startsAt={slot.starts_at}
        endsAt={slot.ends_at}
        location={slot.location}
        description={slot.description}
        delivers={slot.delivers}
        gear={slot.gear}
        floorRateCents={slot.floor_rate_cents}
        stepCents={slot.step_cents}
        claimCents={slot.claim_cents}
        initial={{
          status: isSlotStatus(slot.status) ? slot.status : "open",
          currentCents: slot.current_cents,
          bidCount: slot.bid_count,
          leaderId: slot.leader_id,
          winnerId: slot.winner_id,
          settledCents: slot.settled_cents,
          closesAt: slot.closes_at,
        }}
        initialHistory={entries}
        userId={user?.id ?? null}
        yourMaxCents={yourBid?.max_cents ?? null}
      />
    </main>
  );
}
