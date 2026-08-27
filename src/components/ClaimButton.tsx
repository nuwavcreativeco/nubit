"use client";

import { useState } from "react";
import { claimSlot } from "@/app/slots/[id]/actions";
import { formatCents } from "@/lib/types";

export default function ClaimButton({
  slotId,
  claimCents,
}: {
  slotId: string;
  claimCents: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setError(null);
    setPending(true);
    const result = await claimSlot(slotId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-crew">
            Book the day outright for {formatCents(claimCents)}?
          </span>
          <button
            onClick={handleConfirm}
            disabled={pending}
            className="font-medium text-signal underline disabled:opacity-60"
          >
            {pending ? "Claiming…" : "Yes, claim it"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-crew underline disabled:opacity-60"
          >
            Never mind
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="border border-line px-5 py-3 text-sm font-medium text-key transition hover:border-signal hover:text-signal"
        >
          Claim now &middot; {formatCents(claimCents)} &middot; skip the auction
        </button>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
