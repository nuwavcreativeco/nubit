"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents, isSlotStatus, type SlotStatus } from "@/lib/types";
import Countdown from "@/components/Countdown";

type LiveEntry = {
  slotId: string;
  slotTitle: string;
  yourMaxCents: number;
  currentCents: number | null;
  floorRateCents: number;
  closesAt: string;
  slotStatus: SlotStatus;
  leaderId: string | null;
  winnerId: string | null;
};

function entryStatus(entry: LiveEntry, userId: string) {
  switch (entry.slotStatus) {
    case "cancelled":
      return { text: "Cancelled", className: "text-crew" };
    case "expired":
      return { text: "Closed, no winner", className: "text-crew" };
    case "won":
    case "claimed":
      return entry.winnerId === userId
        ? { text: "You won", className: "text-signal" }
        : { text: "Went to another bidder", className: "text-crew" };
    default:
      return entry.leaderId === userId
        ? { text: "Leading", className: "text-signal" }
        : { text: "Outbid", className: "text-red-400" };
  }
}

export default function MyBidsLive({
  userId,
  initialEntries,
}: {
  userId: string;
  initialEntries: LiveEntry[];
}) {
  const [entries, setEntries] = useState<LiveEntry[]>(initialEntries);

  useEffect(() => {
    const slotIds = entries.map((e) => e.slotId);
    if (slotIds.length === 0) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`my-bids:${userId}`)
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
            status: string;
            current_cents: number | null;
            leader_id: string | null;
            winner_id: string | null;
            closes_at: string;
          };
          setEntries((prev) =>
            prev.map((e) =>
              e.slotId === row.id
                ? {
                    ...e,
                    slotStatus: isSlotStatus(row.status) ? row.status : e.slotStatus,
                    currentCents: row.current_cents,
                    leaderId: row.leader_id,
                    winnerId: row.winner_id,
                    closesAt: row.closes_at,
                  }
                : e
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // Subscribed once for the slots this page loaded with — bidding on a new
    // slot navigates through a fresh page load anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (entries.length === 0) {
    return (
      <p className="mt-8 text-crew">
        You haven&apos;t bid on anything yet.{" "}
        <Link href="/slots" className="text-signal underline">
          Browse open slots
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="mt-8 divide-y divide-line border-t border-line">
      {entries.map((entry) => {
        const status = entryStatus(entry, userId);
        return (
          <li key={entry.slotId}>
            <Link
              href={`/slots/${entry.slotId}`}
              className="flex items-center justify-between gap-4 py-5 transition hover:opacity-80"
            >
              <div>
                <p className="text-lg font-medium">{entry.slotTitle}</p>
                <p className="mt-1 text-sm text-crew">
                  At {formatCents(entry.currentCents ?? entry.floorRateCents)}{" "}
                  &middot; your max {formatCents(entry.yourMaxCents)}
                </p>
                {entry.slotStatus === "open" && (
                  <p className="meta">
                    <Countdown closesAt={entry.closesAt} className="tabular-nums" />
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-medium ${status.className}`}>
                  {status.text}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
