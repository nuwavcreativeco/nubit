import Link from "next/link";
import BidTicker from "@/components/BidTicker";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start gap-12 px-6 py-20 md:flex-row md:items-center md:py-28">
        <div className="max-w-xl">
          <p className="text-xs uppercase tracking-[0.2em] text-brass">
            Seattle &middot; open beta
          </p>
          <h1 className="font-display mt-4 text-4xl leading-[1.05] md:text-6xl">
            Post the floor.
            <br />
            Let the bid climb.
          </h1>
          <p className="mt-6 text-lg text-ink-dim">
            Nubid is where videographers post open shoot slots at a floor day
            rate, and artists and creators bid the price up. No cold
            outreach, no rate guessing — the market sets it.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/slots"
              className="rounded-md bg-brass px-5 py-3 text-sm font-medium text-canvas transition hover:bg-brass-dim"
            >
              Browse open slots
            </Link>
            <Link
              href="/slots/new"
              className="rounded-md border border-line px-5 py-3 text-sm font-medium text-ink transition hover:border-ink-dim"
            >
              Post a slot
            </Link>
          </div>
        </div>

        <div className="flex w-full justify-center md:justify-end">
          <BidTicker />
        </div>
      </section>

      {/* How it works — two roles, not a sequence */}
      <section className="border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-px bg-line md:grid-cols-2">
          <div className="bg-canvas px-6 py-14 md:px-12">
            <p className="text-xs uppercase tracking-widest text-brass">
              Videographers
            </p>
            <h2 className="font-display mt-3 text-2xl">
              Set a floor, not a fixed rate
            </h2>
            <p className="mt-4 text-ink-dim">
              Post an open slot with a date, location, and the lowest rate
              you&apos;d take. Creators compete for it from there — you never
              leave money on the table by guessing low.
            </p>
          </div>
          <div className="bg-canvas px-6 py-14 md:px-12">
            <p className="text-xs uppercase tracking-widest text-teal">
              Artists &amp; creators
            </p>
            <h2 className="font-display mt-3 text-2xl">
              Bid on real, open work
            </h2>
            <p className="mt-4 text-ink-dim">
              Browse slots with a visible floor rate and bid what the shoot
              is worth to you. See where the bidding stands before you
              commit.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-line px-6 py-8 text-center text-xs text-ink-dim">
        Nubid &middot; starting in Seattle
      </footer>
    </main>
  );
}
