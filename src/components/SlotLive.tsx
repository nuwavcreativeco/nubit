"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents, type SlotStatus } from "@/lib/types";
import BidForm from "@/components/BidForm";
import AwardBidButton from "@/components/AwardBidButton";
import CancelSlotButton from "@/components/CancelSlotButton";

type LiveBid = {
  id: string;
  bidderId: string;
  amountCents: number;
  createdAt: string;
  displayName: string;
};

export default function SlotLive({
  slotId,
  videographerId,
  title,
  shootDate,
  location,
  description,
  floorRateCents,
  initialStatus,
  initialAwardedBidId,
  initialBids,
  userId,
}: {
  slotId: string;
  videographerId: string;
  title: string;
  shootDate: string;
  location: string;
  description: string | null;
  floorRateCents: number;
  initialStatus: SlotStatus;
  initialAwardedBidId: string | null;
  initialBids: LiveBid[];
  userId: string | null;
}) {
  const [status, setStatus] = useState<SlotStatus>(initialStatus);
  const [awardedBidId, setAwardedBidId] = useState<string | null>(initialAwardedBidId);
  const [bids, setBids] = useState<LiveBid[]>(initialBids);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`slot:${slotId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bids", filter: `slot_id=eq.${slotId}` },
        (payload) => {
          const row = payload.new as {
            id: string;
            bidder_id: string;
            amount_cents: number;
            created_at: string;
          };

          setBids((prev) => {
            if (prev.some((b) => b.id === row.id)) return prev;
            return [
              ...prev,
              {
                id: row.id,
                bidderId: row.bidder_id,
                amountCents: row.amount_cents,
                createdAt: row.created_at,
                displayName: "Bidder",
              },
            ].sort((a, b) => b.amountCents - a.amountCents);
          });

          supabase
            .from("profiles")
            .select("display_name")
            .eq("id", row.bidder_id)
            .single()
            .then(({ data }) => {
              if (!data) return;
              setBids((prev) =>
                prev.map((b) => (b.id === row.id ? { ...b, displayName: data.display_name } : b))
              );
            });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "slots", filter: `id=eq.${slotId}` },
        (payload) => {
          const row = payload.new as { status: SlotStatus; awarded_bid_id: string | null };
          setStatus(row.status);
          setAwardedBidId(row.awarded_bid_id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slotId]);

  const highBid = bids[0];
  const minCents = highBid ? highBid.amountCents : floorRateCents;
  const isOwner = userId === videographerId;
  const canBid = Boolean(userId) && !isOwner && status === "open";

  return (
    <>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{title}</h1>
          <p className="mt-2 text-ink-dim">
            {new Date(shootDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}{" "}
            &middot; {location}
          </p>
        </div>
        <span className="rounded-full border border-line px-3 py-1 text-xs uppercase tracking-widest text-ink-dim">
          {status}
        </span>
      </div>

      {description && <p className="mt-6 text-ink-dim">{description}</p>}

      <div className="mt-8 rounded-lg border border-line bg-canvas-raised p-6">
        <p className="text-xs uppercase tracking-widest text-ink-dim">
          {highBid ? "Current high bid" : "Floor rate"}
        </p>
        <p className="mt-2 font-display text-4xl text-brass">{formatCents(minCents)}</p>
      </div>

      {status === "awarded" && (
        <p className="mt-6 text-sm text-teal">This slot has been awarded.</p>
      )}

      {status === "cancelled" && (
        <p className="mt-6 text-sm text-ink-dim">This slot was cancelled.</p>
      )}

      {canBid && (
        <div className="mt-8">
          <h2 className="font-display text-xl">Place a bid</h2>
          <div className="mt-4">
            <BidForm slotId={slotId} minCents={minCents} />
          </div>
        </div>
      )}

      {!userId && status === "open" && (
        <p className="mt-8 text-sm text-ink-dim">
          <Link href="/auth/sign-in" className="text-brass underline">
            Sign in
          </Link>{" "}
          to bid on this slot.
        </p>
      )}

      {isOwner && status === "open" && (
        <div className="mt-8 flex items-center justify-between gap-4">
          <p className="text-sm text-ink-dim">
            This is your slot. Award a bid below to close it out.
          </p>
          <CancelSlotButton slotId={slotId} />
        </div>
      )}

      <div className="mt-10">
        <h2 className="font-display text-xl">Bids</h2>

        {bids.length === 0 ? (
          <p className="mt-3 text-ink-dim">No bids yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {bids.map((bid) => (
              <li key={bid.id} className="flex items-center justify-between py-4">
                <div>
                  <p className="text-ink">{bid.displayName}</p>
                  <p className="text-xs text-ink-dim">
                    {new Date(bid.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <span
                    className={`font-display text-lg ${
                      bid.id === awardedBidId ? "text-teal" : "text-ink"
                    }`}
                  >
                    {formatCents(bid.amountCents)}
                  </span>

                  {bid.id === awardedBidId && (
                    <span className="text-xs uppercase tracking-widest text-teal">Awarded</span>
                  )}

                  {isOwner && status === "open" && (
                    <AwardBidButton slotId={slotId} bidId={bid.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
