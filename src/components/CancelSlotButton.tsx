"use client";

import { useState } from "react";
import { cancelSlot } from "@/app/slots/actions";

export default function CancelSlotButton({ slotId }: { slotId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setError(null);
    setPending(true);
    const result = await cancelSlot(slotId);
    setPending(false);
    if (result?.error) setError(result.error);
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-ink-dim">Cancel this slot?</span>
          <button
            onClick={handleConfirm}
            disabled={pending}
            className="font-medium text-red-400 underline disabled:opacity-60"
          >
            {pending ? "Cancelling…" : "Yes, cancel"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-ink-dim underline disabled:opacity-60"
          >
            Never mind
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs text-ink-dim underline transition hover:text-red-400"
    >
      Cancel slot
    </button>
  );
}
