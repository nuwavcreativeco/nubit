"use client";

import { useState } from "react";
import { awardBid } from "@/app/slots/[id]/actions";

export default function AwardBidButton({
  slotId,
  bidId,
}: {
  slotId: string;
  bidId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setError(null);
    setPending(true);
    const result = await awardBid(slotId, bidId);
    setPending(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={pending}
        className="rounded-md border border-brass px-3 py-1.5 text-xs font-medium text-brass transition hover:bg-brass hover:text-canvas disabled:opacity-60"
      >
        {pending ? "Awarding…" : "Award this bid"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
