import Link from "next/link";
import BidTicker from "@/components/BidTicker";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero — single column, left aligned, the way nubid.co opens. */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24 md:py-32">
        <p className="meta flex items-center gap-2 text-key">
          <span className="pip" aria-hidden />
          Live now
        </p>

        <h1 className="mt-6 max-w-4xl text-5xl leading-[0.98] tracking-tight md:text-[60px]">
          Post the floor.
          <br />
          <span className="text-crew">Let the bid climb.</span>
        </h1>

        <p className="mt-8 max-w-xl text-lg leading-7 text-crew">
          NuBid is where videographers post open shoot slots at a floor day
          rate, and artists and creators bid the price up. No cold outreach,
          no rate guessing — the market sets it.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/slots"
            className="btn-signal flex h-12 items-center px-7 text-base"
          >
            Browse open slots
          </Link>
          <Link
            href="/slots/new"
            className="btn-ghost flex h-12 items-center px-8 text-sm"
          >
            Post an open day
          </Link>
        </div>

        <p className="mt-6 text-sm text-crew">
          Browsing is free. You see the work first, the price underneath.
        </p>
      </section>

      {/* The board, live */}
      <section className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="text-3xl tracking-tight">Open slots, live right now</h2>
          <p className="meta mt-2">Sorted by soonest close</p>

          <div className="mt-8 max-w-sm">
            <BidTicker />
          </div>

          <Link
            href="/slots"
            className="meta mt-8 inline-block text-signal transition hover:text-key"
          >
            See every open slot →
          </Link>
        </div>
      </section>

      {/* How it works — two roles, not a sequence */}
      <section className="border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-px bg-line md:grid-cols-2">
          <div className="bg-stage px-6 py-14 md:px-12">
            <p className="meta text-signal">Videographers</p>
            <h2 className="mt-3 text-2xl tracking-tight">
              Set a floor, not a fixed rate
            </h2>
            <p className="mt-4 text-crew">
              Post an open slot with a date, location, and the lowest rate
              you&apos;d take. Creators compete for it from there — you never
              leave money on the table by guessing low.
            </p>
          </div>
          <div className="bg-stage px-6 py-14 md:px-12">
            <p className="meta text-signal">Artists &amp; creators</p>
            <h2 className="mt-3 text-2xl tracking-tight">
              Bid on real, open work
            </h2>
            <p className="mt-4 text-crew">
              Browse slots with a visible floor rate and bid what the shoot is
              worth to you. See where the bidding stands before you commit.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-line px-6 py-8">
        <p className="meta mx-auto max-w-6xl">NuBid</p>
      </footer>
    </main>
  );
}
