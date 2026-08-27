import Link from "next/link";
import Countdown from "@/components/Countdown";
import { formatCents, formatShootDate } from "@/lib/types";

export type BoardSlot = {
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
  videoUrl: string | null;
  posterUrl: string | null;
  aspect: string;
  durationSeconds: number | null;
  videographerName: string;
  handle: string;
  rating: number | null;
  distanceMi: number | null;
};

export type CardRow = {
  id: string;
  title: string;
  shoot_date: string;
  location: string;
  area_label: string | null;
  floor_rate_cents: number;
  current_cents: number | null;
  claim_cents: number;
  closes_at: string;
  bid_count: number;
  video_url: string | null;
  poster_url: string | null;
  aspect: string;
  duration_seconds: number | null;
  videographer_name: string;
  handle: string;
  rating: number | null;
  distance_mi: number | null;
};

/** slots_board() and slots_near() return the same shape on purpose. */
export function toBoardSlot(row: CardRow): BoardSlot {
  return {
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
    videoUrl: row.video_url,
    posterUrl: row.poster_url,
    aspect: row.aspect,
    durationSeconds: row.duration_seconds,
    videographerName: row.videographer_name,
    handle: row.handle,
    rating: row.rating,
    distanceMi: row.distance_mi,
  };
}

function clock(seconds: number | null) {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The board card, built to nubid.co's anatomy: the reel first, then who is
 * shooting it, then the two figures that decide whether you act — the price
 * and the clock — each under its own small label.
 */
export default function SlotCard({ slot }: { slot: BoardSlot }) {
  const bid = slot.bidCount > 0;
  const price = slot.currentCents ?? slot.floorRateCents;

  return (
    <Link
      href={`/slots/${slot.id}`}
      className="group flex flex-col border border-line bg-rack transition hover:border-crew"
    >
      {/* Reel */}
      <span
        className="relative block w-full overflow-hidden bg-rack-2"
        style={{ aspectRatio: slot.aspect === "9:16" ? "9 / 16" : "16 / 9" }}
      >
        {slot.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.posterUrl}
            alt=""
            className="h-full w-full object-cover transition group-hover:opacity-85"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-6 text-center">
            <span className="meta">No reel on this day yet</span>
          </span>
        )}

        <span className="meta absolute left-2 top-2 flex items-center gap-1 text-key">
          <span className="pip" aria-hidden />
          {slot.aspect}
        </span>

        {slot.videoUrl && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-key/40 text-key/80 transition group-hover:border-key group-hover:text-key">
              ▶
            </span>
          </span>
        )}

        {/* The viewfinder strip along the bottom of the frame. */}
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-stage/80 px-2 py-1">
          <span className="meta text-rec">REC</span>
          <span className="flex flex-col items-end leading-none">
            {slot.durationSeconds !== null && (
              <span className="meta text-key">{clock(slot.durationSeconds)}</span>
            )}
            <span className="meta">{slot.aspect}</span>
          </span>
        </span>
      </span>

      {/* Who, where, when */}
      <span className="block px-3 pt-3">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium text-key">
            {slot.videographerName}
          </span>
          {slot.rating !== null && (
            <span className="shrink-0 text-xs text-crew">★ {slot.rating}</span>
          )}
        </span>

        <span className="meta mt-1 block truncate">
          {slot.areaLabel ?? slot.location} &middot; {formatShootDate(slot.shootDate)}
          {slot.distanceMi !== null && (
            <span className="text-signal"> &middot; {slot.distanceMi} mi</span>
          )}
        </span>

        <span className="mt-2 block truncate text-sm text-crew">{slot.title}</span>
      </span>

      {/* The two figures that decide anything */}
      <span className="mt-3 block border-t border-line px-3 py-3">
        <span className="flex items-start justify-between gap-3">
          <span className="flex flex-col">
            <span className="label">{bid ? "High bid" : "Floor"}</span>
            <span className="fig mt-0.5 text-lg text-signal">
              {formatCents(price)}
            </span>
          </span>
          <span className="flex flex-col items-end">
            <span className="label">Left</span>
            <Countdown
              closesAt={slot.closesAt}
              className="fig mt-0.5 text-lg"
              closedLabel="closed"
            />
          </span>
        </span>

        <span className="meta mt-2 block">
          {slot.bidCount} {slot.bidCount === 1 ? "bid" : "bids"} &middot; claim{" "}
          {formatCents(slot.claimCents)}
        </span>
      </span>
    </Link>
  );
}
