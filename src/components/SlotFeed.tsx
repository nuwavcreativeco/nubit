"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatCents, formatShootDate } from "@/lib/types";
import Countdown from "@/components/Countdown";

export type FeedItem = {
  id: string;
  title: string;
  shootDate: string;
  location: string;
  areaLabel: string | null;
  floorRateCents: number;
  currentCents: number | null;
  claimCents: number;
  closesAt: string;
  bidCount: number;
  distanceMi: number | null;
};

export default function SlotFeed({
  allItems,
  initialNearby,
  initialArea,
  signedIn,
}: {
  allItems: FeedItem[];
  initialNearby: FeedItem[] | null;
  initialArea: SearchArea | null;
  signedIn: boolean;
}) {
  const [area, setArea] = useState<SearchArea | null>(initialArea);
  // null means "not filtering" — show everything the server sent.
  const [nearby, setNearby] = useState<FeedItem[] | null>(initialNearby);
  const [busy, setBusy] = useState<"locating" | "loading" | null>(null);
  const [error, setError] = useState<string | null>(null);
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

    setNearby(
      (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        shootDate: row.shoot_date,
        location: row.location,
        areaLabel: row.area_label,
        floorRateCents: row.floor_rate_cents,
        currentCents: row.current_cents,
        claimCents: row.claim_cents,
        closesAt: row.closes_at,
        bidCount: row.bid_count,
        distanceMi: row.distance_mi,
      }))
    );
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

  const items = nearby ?? allItems;
  const filtering = nearby !== null;

  return (
    <>
      <div className="mt-6 border border-line bg-rack p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-crew">
              {filtering ? "Slots near you" : "Everything open"}
            </p>
            <p className="mt-1 text-sm text-crew">
              {filtering
                ? `Within ${area?.radiusMi ?? DEFAULT_RADIUS_MI} miles · ${items.length} ${
                    items.length === 1 ? "slot" : "slots"
                  }`
                : "Turn on location to sort by how far away the shoot is."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {filtering && (
              <button
                onClick={handleClear}
                className="text-xs text-crew underline transition hover:text-key"
              >
                Show all
              </button>
            )}
            <button
              onClick={handleUseMyLocation}
              disabled={busy !== null}
              className="border border-line px-4 py-2 text-sm font-medium text-key transition hover:border-signal hover:text-signal disabled:opacity-60"
            >
              {busy === "locating"
                ? "Locating…"
                : area
                  ? "Update my location"
                  : "Use my location"}
            </button>
          </div>
        </div>

        {area && filtering && (
          <label className="mt-4 flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 text-xs uppercase tracking-widest text-crew">
              Radius
            </span>
            <input
              type="range"
              min={MIN_RADIUS_MI}
              max={MAX_RADIUS_MI}
              step={1}
              value={area.radiusMi}
              onChange={(e) => handleRadius(Number(e.target.value))}
              className="w-full accent-signal"
            />
            <span className="w-20 shrink-0 text-right tabular-nums text-key">
              {area.radiusMi} mi
            </span>
          </label>
        )}

        <p className="mt-3 text-xs text-crew">
          Your location is rounded to about a kilometre before it&apos;s stored, and
          a slot&apos;s exact address only reaches the person who books it.
        </p>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {items.length === 0 && (
        <p className="mt-8 text-crew">
          {filtering ? (
            <>
              Nothing open within {area?.radiusMi ?? DEFAULT_RADIUS_MI} miles. Widen
              the radius, or{" "}
              <button onClick={handleClear} className="text-signal underline">
                show everything
              </button>
              .
            </>
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
      )}

      <ul className="mt-8 divide-y divide-line border-t border-line">
        {items.map((slot) => (
          <li key={slot.id}>
            <Link
              href={`/slots/${slot.id}`}
              className="flex items-center justify-between gap-4 py-5 transition hover:opacity-80"
            >
              <div>
                <p className="font-display text-lg">{slot.title}</p>
                <p className="mt-1 text-sm text-crew">
                  {formatShootDate(slot.shootDate)} &middot;{" "}
                  {slot.areaLabel ?? slot.location}
                  {slot.distanceMi !== null && (
                    <span className="text-signal"> &middot; {slot.distanceMi} mi</span>
                  )}
                </p>
                <p className="mt-1 text-xs uppercase tracking-widest text-crew">
                  <Countdown closesAt={slot.closesAt} className="tabular-nums" />
                  {" · "}
                  {slot.bidCount} {slot.bidCount === 1 ? "bid" : "bids"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-2xl tabular-nums text-signal">
                  {formatCents(slot.currentCents ?? slot.floorRateCents)}
                </p>
                <p className="text-xs uppercase tracking-widest text-crew">
                  {slot.bidCount > 0 ? "current bid" : "floor"}
                </p>
                <p className="mt-1 text-xs text-crew">
                  claim {formatCents(slot.claimCents)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
