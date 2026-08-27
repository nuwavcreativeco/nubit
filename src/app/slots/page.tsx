import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { SearchArea } from "@/lib/geo";
import SlotFeed, { type FeedItem } from "@/components/SlotFeed";

function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export default async function SlotsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="font-display text-2xl">Supabase isn&apos;t connected yet</h1>
        <p className="mt-3 text-crew">
          Copy <code className="text-signal">.env.local.example</code> to{" "}
          <code className="text-signal">.env.local</code>, add your Supabase
          project URL and anon key, then restart the dev server to see real
          slots here.
        </p>
      </main>
    );
  }

  const supabase = await createClient();

  // Soonest to close first — that's the queue a bidder actually cares about.
  const [{ data: slots, error }, { data: { user } }] = await Promise.all([
    supabase
      .from("slots")
      .select("*")
      .eq("status", "open")
      .order("closes_at", { ascending: true }),
    supabase.auth.getUser(),
  ]);

  // A signed-in bidder's search area comes off their profile, so the first
  // paint is already filtered — no location prompt, no flash of the full list.
  let area: SearchArea | null = null;
  let nearby: FeedItem[] | null = null;

  if (user) {
    const { data: areaRows } = await supabase.rpc("my_search_area");
    const saved = areaRows?.[0];
    if (saved) {
      area = { lat: saved.lat, lng: saved.lng, radiusMi: saved.radius_mi };
      const { data: near } = await supabase.rpc("slots_near", {
        p_lat: saved.lat,
        p_lng: saved.lng,
        p_radius_mi: saved.radius_mi,
        p_limit: 100,
      });
      nearby = (near ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        shootDate: row.shoot_date,
        location: row.location,
        areaLabel: row.area_label,
        floorRateCents: row.floor_rate_cents,
        currentCents: row.current_cents,
        claimCents: row.claim_cents,
        closesAt: row.closes_at,
        bidCount: row.bid_count,
        distanceMi: row.distance_mi,
      }));
    }
  }

  const allItems: FeedItem[] = (slots ?? []).map((slot) => ({
    id: slot.id,
    title: slot.title,
    shootDate: slot.shoot_date,
    location: slot.location,
    areaLabel: slot.area_label,
    floorRateCents: slot.floor_rate_cents,
    currentCents: slot.current_cents,
    claimCents: slot.claim_cents,
    closesAt: slot.closes_at,
    bidCount: slot.bid_count,
    distanceMi: null,
  }));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Open slots</h1>
        <Link
          href="/slots/new"
          className="bg-signal px-4 py-2 text-sm font-medium text-stage transition hover:bg-signal-dim"
        >
          Post a slot
        </Link>
      </div>

      {error && (
        <p className="mt-8 text-sm text-red-400">
          Couldn&apos;t load slots: {error.message}
        </p>
      )}

      <SlotFeed
        allItems={allItems}
        initialNearby={nearby}
        initialArea={area}
        signedIn={Boolean(user)}
      />
    </main>
  );
}
