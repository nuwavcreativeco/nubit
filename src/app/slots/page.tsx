import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCents, type Slot } from "@/lib/types";

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
        <p className="mt-3 text-ink-dim">
          Copy <code className="text-brass">.env.local.example</code> to{" "}
          <code className="text-brass">.env.local</code>, add your Supabase
          project URL and anon key, then restart the dev server to see real
          slots here.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: slots, error } = await supabase
    .from("slots")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Open slots</h1>
        <Link
          href="/slots/new"
          className="rounded-md bg-brass px-4 py-2 text-sm font-medium text-canvas transition hover:bg-brass-dim"
        >
          Post a slot
        </Link>
      </div>

      {error && (
        <p className="mt-8 text-sm text-red-400">
          Couldn&apos;t load slots: {error.message}
        </p>
      )}

      {!error && slots && slots.length === 0 && (
        <p className="mt-8 text-ink-dim">
          No open slots yet. Be the first to{" "}
          <Link href="/slots/new" className="text-brass underline">
            post one
          </Link>
          .
        </p>
      )}

      <ul className="mt-8 divide-y divide-line border-t border-line">
        {(slots as Slot[] | null)?.map((slot) => (
          <li key={slot.id}>
            <Link
              href={`/slots/${slot.id}`}
              className="flex items-center justify-between py-5 transition hover:opacity-80"
            >
              <div>
                <p className="font-display text-lg">{slot.title}</p>
                <p className="mt-1 text-sm text-ink-dim">
                  {new Date(slot.shoot_date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  &middot; {slot.location}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-brass">
                  {formatCents(slot.floor_rate_cents)}
                </p>
                <p className="text-xs uppercase tracking-widest text-ink-dim">
                  floor
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
