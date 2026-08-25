import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Slot } from "@/lib/types";
import MySlotsLive from "@/components/MySlotsLive";

export default async function MySlotsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="font-display text-2xl">Sign in to see your slots</h1>
        <p className="mt-3 text-ink-dim">
          <Link href="/auth/sign-in" className="text-brass underline">
            Sign in
          </Link>{" "}
          to see the slots you've posted.
        </p>
      </main>
    );
  }

  const { data: slots } = await supabase
    .from("slots")
    .select("*")
    .eq("videographer_id", user.id)
    .order("created_at", { ascending: false });

  const typedSlots = (slots ?? []) as Slot[];
  const slotIds = typedSlots.map((s) => s.id);

  const { data: bids } = slotIds.length
    ? await supabase.from("bids").select("slot_id").in("slot_id", slotIds)
    : { data: [] };

  const bidCountBySlot = new Map<string, number>();
  for (const bid of bids ?? []) {
    bidCountBySlot.set(bid.slot_id, (bidCountBySlot.get(bid.slot_id) ?? 0) + 1);
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">My slots</h1>
        <Link
          href="/slots/new"
          className="rounded-md bg-brass px-4 py-2 text-sm font-medium text-canvas transition hover:bg-brass-dim"
        >
          Post a slot
        </Link>
      </div>

      <MySlotsLive
        videographerId={user.id}
        initialSlots={typedSlots.map((slot) => ({
          id: slot.id,
          title: slot.title,
          shootDate: slot.shoot_date,
          location: slot.location,
          floorRateCents: slot.floor_rate_cents,
          status: slot.status,
          bidCount: bidCountBySlot.get(slot.id) ?? 0,
        }))}
      />
    </main>
  );
}
