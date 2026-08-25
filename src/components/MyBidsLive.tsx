"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents, type SlotStatus } from "@/lib/types";

type LiveBid = {
  id: string;
  amountCents: number;
  slotId: string;
  slotTitle: string;
  slotStatus: SlotStatus;
  awardedBidId: string | null;
  floorRateCents: number;
};

function bidStatusLabel(bid: LiveBid, highestBySlot: Map<string, number>) {
  if (bid.slotStatus === "cancelled") {
    return { text: "Cancelled", className: "text-ink-dim" };
  }
  if (bid.slotStatus === "awarded") {
    return bid.awardedBidId === bid.id
      ? { text: "You won", className: "text-teal" }
      : { text: "Awarded to another bidder", className: "text-ink-dim" };
  }
  const highest = highestBySlot.get(bid.slotId) ?? bid.floorRateCents;
  return bid.amountCents >= highest
    ? { text: "Winning", className: "text-teal" }
    : { text: "Outbid", className: "text-red-400" };
}

export default function MyBidsLive({
  userId,
  initialBids,
  initialHighestBySlot,
}: {
  userId: string;
  initialBids: LiveBid[];
  initialHighestBySlot: Record<string, number>;
}) {
  const [bids, setBids] = useState<LiveBid[]>(initialBids);
  const [highestBySlot, setHighestBySlot] = useState<Map<string, number>>(
    () => new Map(Object.entries(initialHighestBySlot))
  );

  useEffect(() => {
    const supabase = createClient();
    const slotIds = [...new Set(initialBids.map((b) => b.slotId))];
    if (slotIds.length === 0) return;

    const channel = supabase
      .channel(`my-bids:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `slot_id=in.(${slotIds.join(",")})`,
        },
        (payload) => {
          const row = payload.new as { slot_id: string; amount_cents: number };
          setHighestBySlot((prev) => {
            const current = prev.get(row.slot_id) ?? 0;
            if (row.amount_cents <= current) return prev;
            const next = new Map(prev);
            next.set(row.slot_id, row.amount_cents);
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "slots",
          filter: `id=in.(${slotIds.join(",")})`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            status: SlotStatus;
            awarded_bid_id: string | null;
          };
          setBids((prev) =>
            prev.map((b) =>
              b.slotId === row.id
                ? { ...b, slotStatus: row.status, awardedBidId: row.awarded_bid_id }
                : b
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // Subscribe once for the slots this page loaded with — a bid placed
    // after mount on a not-yet-seen slot won't be covered until reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (bids.length === 0) {
    return (
      <p className="mt-8 text-ink-dim">
        You haven&apos;t bid on anything yet.{" "}
        <Link href="/slots" className="text-brass underline">
          Browse open slots
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="mt-8 divide-y divide-line border-t border-line">
      {bids.map((bid) => {
        const status = bidStatusLabel(bid, highestBySlot);
        return (
          <li key={bid.id}>
            <Link
              href={`/slots/${bid.slotId}`}
              className="flex items-center justify-between py-5 transition hover:opacity-80"
            >
              <div>
                <p className="font-display text-lg">{bid.slotTitle}</p>
                <p className="mt-1 text-sm text-ink-dim">
                  Your bid: {formatCents(bid.amountCents)}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-medium ${status.className}`}>{status.text}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
