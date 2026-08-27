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
        <div>
          <h1 className="font-display text-3xl">{title}</h1>
          <p className="mt-2 text-crew">
            {videographerName}
            {rating !== null && (
              <>
                {" "}
                &middot; {rating} ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-crew">
            {formatShootDate(shootDate)} &middot; {formatShootWindow(startsAt, endsAt)}{" "}
            &middot; {location}
          </p>
        </div>
        <span className="border border-line px-3 py-1 text-xs uppercase tracking-widest text-crew">
          {state.status}
        </span>
      </div>

      {description && <p className="mt-6 text-crew">{description}</p>}

      {(delivers.length > 0 || gear.length > 0) && (
        <div className="mt-6 flex flex-wrap gap-2">
          {[...delivers, ...gear].map((item) => (
            <span
              key={item}
              className="border border-line px-3 py-1 text-xs uppercase tracking-widest text-crew"
            >
              {item}
            </span>
          ))}
        </div>
      )}

      <div className="mt-8 border border-line bg-rack p-6">
        {isOpen && (
          <div className="flex items-center justify-between text-xs uppercase tracking-widest text-crew">
            <span>Bidding closes</span>
            <Countdown closesAt={state.closesAt} className="tabular-nums text-key" />
          </div>
        )}

        <p className="mt-4 text-xs uppercase tracking-widest text-crew">
          {state.bidCount > 0 ? "Current bid" : "Floor day rate"}
        </p>
        <p className="mt-2 font-display text-5xl tabular-nums text-signal">
          {formatCents(state.settledCents ?? priceCents)}
        </p>
        <p className="mt-2 text-sm text-crew">
          Floor {formatCents(floorRateCents)} &middot; step {formatCents(stepCents)}{" "}
          &middot; {state.bidCount} {state.bidCount === 1 ? "bid" : "bids"}
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
          <h2 className="font-display text-xl">Place a bid</h2>
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
        <h2 className="font-display text-xl">Bid history</h2>

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
                <p className="text-xs text-crew">
                  {new Date(entry.bidAt).toLocaleString("en-US", {
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
        <p className="mt-3 text-xs text-crew">
          Names stay masked and amounts stay private until bidding closes —
          only the price on the board is public.
        </p>
      </div>
    </>
  );
}
