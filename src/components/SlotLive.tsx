"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  formatCents,
  formatShootDate,
  formatShootWindow,
  isSlotStatus,
  type SlotStatus,
} from "@/lib/types";
import BidForm from "@/components/BidForm";
import ClaimButton from "@/components/ClaimButton";
import CancelSlotButton from "@/components/CancelSlotButton";
import Countdown from "@/components/Countdown";

export type HistoryEntry = {
  bidAt: string;
  bidder: string;
  isYou: boolean;
};

type LiveState = {
  status: SlotStatus;
  currentCents: number | null;
  bidCount: number;
  leaderId: string | null;
  winnerId: string | null;
  settledCents: number | null;
  closesAt: string;
};

export default function SlotLive({
  slotId,
  videographerId,
  videographerName,
  rating,
  reviewCount,
  title,
  shootDate,
  startsAt,
  endsAt,
  location,
  description,
  delivers,
  gear,
  floorRateCents,
  stepCents,
  claimCents,
  initial,
  initialHistory,
  userId,
  yourMaxCents,
}: {
  slotId: string;
  videographerId: string;
  videographerName: string;
  rating: number | null;
  reviewCount: number | null;
  title: string;
  shootDate: string;
  startsAt: string;
  endsAt: string;
  location: string;
  description: string | null;
  delivers: string[];
  gear: string[];
  floorRateCents: number;
  stepCents: number;
  claimCents: number;
  initial: LiveState;
  initialHistory: HistoryEntry[];
  userId: string | null;
  yourMaxCents: number | null;
}) {
  const [state, setState] = useState<LiveState>(initial);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);

  // Bids are only readable by the bidder who placed them, so Postgres
  // Changes on `bids` would never deliver a rival's bid. Everything the page
  // needs rides along on the slots row instead; the masked history comes
  // back from the RPC whenever that row moves.
  const refreshHistory = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("slot_bid_history", { p_slot: slotId });
    if (!data) return;
    setHistory(
      data.map((row) => ({
        bidAt: row.bid_at,
        bidder: row.bidder,
        isYou: row.is_you,
      }))
    );
  }, [slotId]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`slot:${slotId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "slots", filter: `id=eq.${slotId}` },
        (payload) => {
          const row = payload.new as {
            status: string;
            current_cents: number | null;
            bid_count: number;
            leader_id: string | null;
            winner_id: string | null;
            settled_cents: number | null;
            closes_at: string;
          };
          setState({
            status: isSlotStatus(row.status) ? row.status : "open",
            currentCents: row.current_cents,
            bidCount: row.bid_count,
            leaderId: row.leader_id,
            winnerId: row.winner_id,
            settledCents: row.settled_cents,
            closesAt: row.closes_at,
          });
          void refreshHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slotId, refreshHistory]);

  const priceCents = state.currentCents ?? floorRateCents;
  const nextCents =
    state.currentCents === null ? floorRateCents : state.currentCents + stepCents;
  const isOwner = userId === videographerId;
  const isOpen = state.status === "open";
  const canBid = Boolean(userId) && !isOwner && isOpen && nextCents <= claimCents;
  const youLead = userId !== null && state.leaderId === userId;
  const youWon = userId !== null && state.winnerId === userId;

  return (
    <>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl tracking-tight">{title}</h1>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-sm font-medium text-key">{videographerName}</span>
            {rating !== null && (
              <span className="text-xs text-crew">
                ★ {rating} ({reviewCount})
              </span>
            )}
          </p>
          <p className="meta mt-1">
            {location} &middot; {formatShootDate(shootDate)} &middot;{" "}
            {formatShootWindow(startsAt, endsAt)}
          </p>
        </div>
        <span className="meta shrink-0 border border-line px-3 py-1">
          {state.status}
        </span>
      </div>

      {description && <p className="mt-6 text-crew">{description}</p>}

      {(delivers.length > 0 || gear.length > 0) && (
        <div className="mt-6 flex flex-wrap gap-2">
          {[...delivers, ...gear].map((item) => (
            <span key={item} className="meta border border-line px-3 py-1">
              {item}
            </span>
          ))}
        </div>
      )}

      {/* The two figures, paired with their labels, as on the board card. */}
      <div className="mt-8 border border-line bg-rack p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col">
            <span className="label">
              {state.bidCount > 0 ? "High bid" : "Floor"}
            </span>
            <span className="fig mt-1 text-4xl text-signal">
              {formatCents(state.settledCents ?? priceCents)}
            </span>
          </div>

          {isOpen && (
            <div className="flex flex-col items-end">
              <span className="label">Left</span>
              <Countdown
                closesAt={state.closesAt}
                className="fig mt-1 text-4xl"
                closedLabel="closed"
              />
            </div>
          )}
        </div>

        <p className="meta mt-4">
          {state.bidCount} {state.bidCount === 1 ? "bid" : "bids"} &middot; floor{" "}
          {formatCents(floorRateCents)} &middot; step {formatCents(stepCents)}{" "}
          &middot; claim {formatCents(claimCents)}
        </p>

        {isOpen && youLead && (
          <p className="mt-3 text-sm text-signal">You&apos;re leading this one.</p>
        )}
      </div>

      {state.status === "won" && (
        <p className="mt-6 text-sm text-signal">
          {youWon
            ? `You won this day at ${formatCents(state.settledCents ?? priceCents)}.`
            : "Bidding closed — this day went to the leading bidder."}
        </p>
      )}
      {state.status === "claimed" && (
        <p className="mt-6 text-sm text-signal">
          {youWon
            ? `You claimed this day at ${formatCents(state.settledCents ?? claimCents)}.`
            : "Someone claimed this day outright."}
        </p>
      )}
      {state.status === "expired" && (
        <p className="mt-6 text-sm text-crew">
          Bidding closed with no bids — this day went unclaimed.
        </p>
      )}
      {state.status === "cancelled" && (
        <p className="mt-6 text-sm text-crew">This slot was cancelled.</p>
      )}

      {canBid && (
        <div className="mt-8">
          <h2 className="text-xl tracking-tight">Place a bid</h2>
          <div className="mt-4">
            <BidForm
              slotId={slotId}
              nextCents={nextCents}
              stepCents={stepCents}
              claimCents={claimCents}
              yourMaxCents={yourMaxCents}
            />
          </div>
          <div className="mt-4">
            <ClaimButton slotId={slotId} claimCents={claimCents} />
          </div>
        </div>
      )}

      {!userId && isOpen && (
        <p className="mt-8 text-sm text-crew">
          <Link href="/auth/sign-in" className="text-signal underline">
            Sign in
          </Link>{" "}
          to bid on this slot.
        </p>
      )}

      {isOwner && isOpen && (
        <div className="mt-8 flex items-center justify-between gap-4">
          <p className="text-sm text-crew">
            This is your slot. It settles on its own when bidding closes.
          </p>
          <CancelSlotButton slotId={slotId} />
        </div>
      )}

      <div className="mt-10">
        <h2 className="text-xl tracking-tight">Bid history</h2>

        {history.length === 0 ? (
          <p className="mt-3 text-crew">No bids yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {history.map((entry, index) => (
              <li
                key={`${entry.bidAt}-${index}`}
                className="flex items-center justify-between py-4"
              >
                <p className={entry.isYou ? "text-signal" : "text-key"}>
                  {entry.isYou ? "You" : entry.bidder}
                </p>
                <p className="meta">                  {new Date(entry.bidAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="meta mt-3">
          Names stay masked and amounts stay private until bidding closes —
          only the price on the board is public.
        </p>
      </div>
    </>
  );
}
