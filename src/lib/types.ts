import type { Tables } from "@/lib/database.types";

// Row shapes come straight from the generated types so a migration that
// changes a column breaks the build instead of the deployed app.
export type Profile = Tables<"profiles">;
export type Slot = Tables<"slots">;
export type Bid = Tables<"bids">;
export type Review = Tables<"reviews">;
export type VideographerStats = Tables<"videographer_stats">;

export const ROLES = ["videographer", "artist", "bidder", "both"] as const;
export type Role = (typeof ROLES)[number];

// Mirrors the slots.status check constraint. A slot is decided either by
// close_due_slots() at closes_at ('won' / 'expired') or by claim_slot()
// ('claimed'); there is no manual award step any more.
export const SLOT_STATUSES = [
  "draft",
  "open",
  "claimed",
  "won",
  "expired",
  "cancelled",
] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export function isSlotStatus(value: string): value is SlotStatus {
  return (SLOT_STATUSES as readonly string[]).includes(value);
}

/** What place_bid() / claim_slot() return, once past the error cases. */
export type BidOutcome = {
  outcome: "leading" | "outbid" | "ceiling_hit" | "claimed";
  price_cents: number;
  your_max?: number;
  extended?: boolean;
  leading?: boolean;
};

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** The price on the board: the floor until someone bids. */
export function currentCents(slot: {
  current_cents: number | null;
  floor_rate_cents: number;
}): number {
  return slot.current_cents ?? slot.floor_rate_cents;
}

/**
 * The smallest max a bidder can enter. place_bid() requires a step-aligned
 * amount at or above the floor, so the first bid is the floor itself and
 * every one after that clears the current price by a step.
 */
export function nextBidCents(slot: {
  current_cents: number | null;
  floor_rate_cents: number;
  step_cents: number;
}): number {
  if (slot.current_cents === null) return slot.floor_rate_cents;
  return slot.current_cents + slot.step_cents;
}

export function formatShootDate(isoDate: string): string {
  // shoot_date is a bare date; parsing it as UTC and formatting in UTC keeps
  // it from sliding a day backwards for viewers west of Greenwich.
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatShootWindow(startsAt: string, endsAt: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const suffix = h >= 12 ? "pm" : "am";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
  };
  return `${fmt(startsAt)}–${fmt(endsAt)}`;
}

/**
 * Two adaptive units, matching how nubid.co renders a clock: "2d 5h",
 * "5h 59m", then "29m 57s" inside the last hour, where the seconds start
 * to matter.
 */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "closed";
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
