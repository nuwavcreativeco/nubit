"use client";

import { useState } from "react";
import { placeBid } from "@/app/slots/[id]/actions";
import { formatCents, type BidOutcome } from "@/lib/types";

export default function BidForm({
  slotId,
  nextCents,
  stepCents,
  claimCents,
  yourMaxCents,
}: {
  slotId: string;
  nextCents: number;
  stepCents: number;
  claimCents: number;
  yourMaxCents: number | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BidOutcome | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setOutcome(null);
    setPending(true);
    const result = await placeBid(slotId, formData);
    setPending(false);
    if ("error" in result) setError(result.error);
    else setOutcome(result.outcome);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm">
        Your max &mdash; we bid the {formatCents(stepCents)} steps for you, and
        stop as soon as you&apos;re in front
        <input
          type="number"
          name="max"
          min={nextCents / 100}
          max={claimCents / 100}
          step={stepCents / 100}
          required
          defaultValue={nextCents / 100}
          className="border border-line bg-rack px-3 py-2 text-key outline-none focus:border-signal"
        />
      </label>

      <p className="text-xs text-crew">
        {formatCents(nextCents)} minimum &middot; up to {formatCents(claimCents)}
        {yourMaxCents !== null && (
          <> &middot; your current max is {formatCents(yourMaxCents)}</>
        )}
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {outcome && (
        <p
          className={`text-sm ${
            outcome.outcome === "outbid" ? "text-red-400" : "text-signal"
          }`}
        >
          {outcome.outcome === "leading" &&
            `You're leading at ${formatCents(outcome.price_cents)}.`}
          {outcome.outcome === "outbid" &&
            `Someone's max is higher — the price is ${formatCents(
              outcome.price_cents
            )} and you're behind it.`}
          {outcome.outcome === "ceiling_hit" &&
            `That hit the claim price. ${
              outcome.leading ? "The day is yours." : "Another bidder took it."
            }`}
          {outcome.extended && " Bidding was extended five minutes."}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-signal px-5 py-3 text-sm font-medium text-stage transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Placing bid…" : "Place bid"}
      </button>
    </form>
  );
}
