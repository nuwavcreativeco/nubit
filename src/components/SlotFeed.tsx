"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { saveMyLocation, saveSearchRadius } from "@/app/slots/location-actions";
import {
  DEFAULT_RADIUS_MI,
  MAX_RADIUS_MI,
  MIN_RADIUS_MI,
  getCurrentCoords,
  readStoredArea,
  storeArea,
  type SearchArea,
} from "@/lib/geo";
import SlotCard, { toBoardSlot, type BoardSlot, type CardRow } from "@/components/SlotCard";

export type { BoardSlot as FeedItem };

const ASPECT_CHIPS = ["All", "16:9", "9:16"] as const;

export default function SlotFeed({
  allItems,
  initialNearby,
  initialArea,
  signedIn,
}: {
  allItems: BoardSlot[];
  initialNearby: BoardSlot[] | null;
  initialArea: SearchArea | null;
  signedIn: boolean;
}) {
  const [area, setArea] = useState<SearchArea | null>(initialArea);
  // null means "not filtering" — show everything the server sent.
  const [nearby, setNearby] = useState<BoardSlot[] | null>(initialNearby);
  const [busy, setBusy] = useState<"locating" | "loading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState<(typeof ASPECT_CHIPS)[number]>("All");
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNearby = useCallback(async (next: SearchArea) => {
    setBusy("loading");
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("slots_near", {
      p_lat: next.lat,
      p_lng: next.lng,
      p_radius_mi: next.radiusMi,
      p_limit: 100,
    });
    setBusy(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNearby((data ?? []).map((row) => toBoardSlot(row as CardRow)));
  }, []);

  // A signed-out visitor's area lives in this browser only; a signed-in one
  // arrives from their profile already rendered by the server.
  useEffect(() => {
    if (signedIn || initialArea) return;
    const stored = readStoredArea();
    if (!stored) return;
    // Adopting the stored area is the callback that follows reading it, not a
    // render-time state update.
    void (async () => {
      setArea(stored);
      await fetchNearby(stored);
    })();
  }, [signedIn, initialArea, fetchNearby]);

  async function handleUseMyLocation() {
    setBusy("locating");
    setError(null);
    try {
      const coords = await getCurrentCoords();
      const next: SearchArea = {
        ...coords,
        radiusMi: area?.radiusMi ?? DEFAULT_RADIUS_MI,
      };
      setArea(next);

      if (signedIn) {
        const result = await saveMyLocation(next.lat, next.lng);
        if ("error" in result) {
          setBusy(null);
          setError(result.error);
          return;
        }
      } else {
        storeArea(next);
      }

      await fetchNearby(next);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Couldn't read your location.");
    }
  }

  function handleRadius(miles: number) {
    if (!area) return;
    const next = { ...area, radiusMi: miles };
    setArea(next);

    // Redraw against the new radius as the slider moves, but only write it
    // down once the user settles on a number.
    void fetchNearby(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (signedIn) void saveSearchRadius(miles);
      else storeArea(next);
    }, 500);
  }

  function handleClear() {
    setNearby(null);
    setError(null);
    if (!signedIn) storeArea(null);
  }

  const source = nearby ?? allItems;
  const filtering = nearby !== null;

  const ceiling = useMemo(() => {
    const top = Math.max(
      0,
      ...source.map((s) => s.currentCents ?? s.floorRateCents)
    );
    // Round up to a clean number so the slider's top end has a sane label.
    return Math.max(100000, Math.ceil(top / 50000) * 50000);
  }, [source]);

  const items = useMemo(
    () =>
      source.filter((slot) => {
        if (aspect !== "All" && slot.aspect !== aspect) return false;
        if (maxPrice !== null && (slot.currentCents ?? slot.floorRateCents) > maxPrice) {
          return false;
        }
        return true;
      }),
    [source, aspect, maxPrice]
  );

  return (
    <>
      {/* Filter row, in the site's chip-and-slider style */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-3">
        <div className="flex gap-px bg-line">
          {ASPECT_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => setAspect(chip)}
              className={`px-4 py-1.5 text-sm transition ${
                aspect === chip
                  ? "bg-rack-2 font-medium text-key"
                  : "bg-rack text-crew hover:text-key"
              }`}
            >
              {chip}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-3">
          <span className="label">Price</span>
          <input
            type="range"
            min={10000}
            max={ceiling}
            step={10000}
            value={maxPrice ?? ceiling}
            onChange={(e) => {
              const value = Number(e.target.value);
              setMaxPrice(value >= ceiling ? null : value);
            }}
            className="w-36 accent-signal"
          />
          <span className="meta w-28 shrink-0">
            {maxPrice === null
              ? `$0–$${(ceiling / 100).toLocaleString()}`
              : `up to $${(maxPrice / 100).toLocaleString()}`}
          </span>
        </label>

        <div className="ml-auto flex items-center gap-3">
          {filtering && area && (
            <label className="flex items-center gap-2">
              <span className="label">Within</span>
              <input
                type="range"
                min={MIN_RADIUS_MI}
                max={MAX_RADIUS_MI}
                step={1}
                value={area.radiusMi}
                onChange={(e) => handleRadius(Number(e.target.value))}
                className="w-28 accent-signal"
              />
              <span className="meta w-12 shrink-0">{area.radiusMi} mi</span>
            </label>
          )}

          {filtering && (
            <button
              onClick={handleClear}
              className="meta text-crew underline transition hover:text-key"
            >
              Show all
            </button>
          )}

          <button
            onClick={handleUseMyLocation}
            disabled={busy !== null}
            className="btn-ghost h-9 px-4 text-sm disabled:opacity-60"
          >
            {busy === "locating"
              ? "Locating…"
              : area
                ? "Update location"
                : "Near me"}
          </button>
        </div>
      </div>

      <p className="meta mt-3">
        {busy === "loading"
          ? "Loading…"
          : filtering
            ? `Within ${area?.radiusMi ?? DEFAULT_RADIUS_MI} miles · ${items.length} ${
                items.length === 1 ? "slot" : "slots"
              }`
            : `${items.length} open · sorted by soonest close`}
      </p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {items.length === 0 ? (
        <p className="mt-10 text-crew">
          {filtering ? (
            <>
              Nothing open within {area?.radiusMi ?? DEFAULT_RADIUS_MI} miles.
              Widen the radius, or{" "}
              <button onClick={handleClear} className="text-signal underline">
                show everything
              </button>
              .
            </>
          ) : source.length > 0 ? (
            "No slots match those filters."
          ) : (
            <>
              No open slots yet. Be the first to{" "}
              <Link href="/slots/new" className="text-signal underline">
                post one
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {items.map((slot) => (
            <li key={slot.id}>
              <SlotCard slot={slot} />
            </li>
          ))}
        </ul>
      )}

      <p className="meta mt-8">
        Your location is rounded to about a kilometre before it&apos;s stored, and
        a slot&apos;s exact address only reaches the person who books it.
      </p>
    </>
  );
}
