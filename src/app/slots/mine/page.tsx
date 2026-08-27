import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isSlotStatus } from "@/lib/types";
import MySlotsLive from "@/components/MySlotsLive";

export default async function MySlotsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="text-2xl tracking-tight">Sign in to see your slots</h1>
        <p className="mt-3 text-crew">
          <Link href="/auth/sign-in" className="text-signal underline">
            Sign in
          </Link>{" "}
          to see the slots you&apos;ve posted.
        </p>
      </main>
    );
  }

  // bid_count lives on the slot itself now — a separate count over `bids`
  // would only ever see this user's own rows under the bids RLS policy.
  const { data: slots } = await supabase
    .from("slots")
    .select("*")
    .eq("videographer_id", user.id)
    .order("closes_at", { ascending: true });

  // slot_locations holds the exact point and is readable by the slot's owner,
  // so this doubles as "which of my slots are pinned".
  const slotIds = (slots ?? []).map((slot) => slot.id);
  const { data: pinned } = slotIds.length
    ? await supabase.from("slot_locations").select("slot_id").in("slot_id", slotIds)
    : { data: [] };
  const located = new Set((pinned ?? []).map((row) => row.slot_id));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl tracking-tight">My slots</h1>
        <Link
          href="/slots/new"
          className="bg-signal px-4 py-2 text-sm font-medium text-stage transition hover:bg-signal-dim"
        >
          Post a slot
        </Link>
      </div>

      <MySlotsLive
        videographerId={user.id}
        initialSlots={(slots ?? []).map((slot) => ({
          id: slot.id,
          title: slot.title,
          shootDate: slot.shoot_date,
          location: slot.location,
          floorRateCents: slot.floor_rate_cents,
          currentCents: slot.current_cents,
          closesAt: slot.closes_at,
          status: isSlotStatus(slot.status) ? slot.status : "open",
          bidCount: slot.bid_count,
          located: located.has(slot.id),
        }))}
      />
    </main>
  );
}
