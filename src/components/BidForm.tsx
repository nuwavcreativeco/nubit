"use client";

import { useState } from "react";
import { placeBid } from "@/app/slots/[id]/actions";
import { formatCents } from "@/lib/types";

export default function BidForm({
  slotId,
  minCents,
}: {
  slotId: string;
  minCents: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await placeBid(slotId, formData);
    setPending(false);
    if (result?.error) setError(result.error);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm">
        Your bid (USD) &mdash; beat {formatCents(minCents)}
        <input
          type="number"
          name="amount"
          min={minCents / 100 + 1}
          step="1"
          required
          placeholder={String(minCents / 100 + 1)}
          className="rounded-md border border-line bg-canvas-raised px-3 py-2 text-ink outline-none focus:border-teal"
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-teal px-5 py-3 text-sm font-medium text-canvas transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Placing bid…" : "Place bid"}
      </button>
    </form>
  );
}
