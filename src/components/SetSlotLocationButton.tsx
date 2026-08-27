"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSlotLocation } from "@/app/slots/location-actions";
import { getCurrentCoords } from "@/lib/geo";

/**
 * Pins an already-posted slot to wherever the videographer is standing.
 * set_slot_location() refuses once a slot has bids, so this only shows up
 * while the location can still honestly move.
 */
export default function SetSlotLocationButton({
  slotId,
  address,
  located,
}: {
  slotId: string;
  address: string;
  located: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(event: React.MouseEvent) {
    // The whole row is a link to the slot; setting a location isn't opening it.
    event.preventDefault();
    event.stopPropagation();

    setPending(true);
    setError(null);
    try {
      const coords = await getCurrentCoords();
      const result = await saveSlotLocation(slotId, coords.lat, coords.lng, address);
      setPending(false);
      if ("error" in result) setError(result.error);
      else router.refresh();
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : "Couldn't read your location.");
    }
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        onClick={handleClick}
        disabled={pending}
        className="text-xs text-crew underline transition hover:text-signal disabled:opacity-60"
      >
        {pending
          ? "Setting location…"
          : located
            ? "Update location from here"
            : "Set location from here"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
