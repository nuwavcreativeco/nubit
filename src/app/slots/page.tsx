import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { SearchArea } from "@/lib/geo";
import SlotFeed, { type FeedItem } from "@/components/SlotFeed";
import { toBoardSlot } from "@/components/SlotCard";

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
        <h1 className="text-2xl tracking-tight">Supabase isn&apos;t connected yet</h1>
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
  // slots_board() returns the same shape as slots_near(), so one card renders
  // both and a phone client reads the identical contract.
  const [{ data: slots, error }, { data: { user } }] = await Promise.all([
    supabase.rpc("slots_board", { p_limit: 100 }),
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
      nearby = (near ?? []).map(toBoardSlot);
    }
  }

  const allItems: FeedItem[] = (slots ?? []).map(toBoardSlot);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl tracking-tight">Open slots</h1>
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
