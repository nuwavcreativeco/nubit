"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  formatCents,
  formatShootDate,
  isSlotStatus,
  type SlotStatus,
} from "@/lib/types";
import Countdown from "@/components/Countdown";
import SetSlotLocationButton from "@/components/SetSlotLocationButton";

type LiveSlot = {
  id: string;
  title: string;
  shootDate: string;
  location: string;
  floorRateCents: number;
  currentCents: number | null;
  closesAt: string;
  status: SlotStatus;
  bidCount: number;
  located: boolean;
};

export default function MySlotsLive({
  videographerId,
  initialSlots,
}: {
  videographerId: string;
  initialSlots: LiveSlot[];
}) {
  const [slots, setSlots] = useState<LiveSlot[]>(initialSlots);

  useEffect(() => {
    const supabase = createClient();

    // slots carries its own bid_count and current_cents, so one subscription
    // on the poster's own rows covers price, bid count, and settlement.
    const channel = supabase
      .channel(`my-slots:${videographerId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "slots",
          filter: `videographer_id=eq.${videographerId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            status: string;
            bid_count: number;
            current_cents: number | null;
            closes_at: string;
          };
          setSlots((prev) =>
            prev.map((s) =>
              s.id === row.id
                ? {
                    ...s,
                    status: isSlotStatus(row.status) ? row.status : s.status,
                    bidCount: row.bid_count,
                    currentCents: row.current_cents,
                    closesAt: row.closes_at,
                  }
                : s
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [videographerId]);

  if (slots.length === 0) {
    return (
      <p className="mt-8 text-crew">
        You haven&apos;t posted a slot yet.{" "}
        <Link href="/slots/new" className="text-signal underline">
          Post one
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="mt-8 divide-y divide-line border-t border-line">
      {slots.map((slot) => (
        <li key={slot.id}>
          <Link
            href={`/slots/${slot.id}`}
            className="flex items-center justify-between gap-4 py-5 transition hover:opacity-80"
          >
            <div>
              <p className="text-lg font-medium">{slot.title}</p>
              <p className="mt-1 text-sm text-crew">
                {formatShootDate(slot.shootDate)} &middot; {slot.location} &middot;{" "}
                {slot.bidCount} {slot.bidCount === 1 ? "bid" : "bids"}
              </p>
              {slot.status === "open" && (
                <p className="meta">
                  <Countdown closesAt={slot.closesAt} className="tabular-nums" />
                </p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <span className={slot.located ? "text-signal" : "text-crew"}>
                  {slot.located ? "Pinned for nearby search" : "No pin — hidden from nearby search"}
                </span>
                {slot.status === "open" && slot.bidCount === 0 && (
                  <SetSlotLocationButton
                    slotId={slot.id}
                    address={slot.location}
                    located={slot.located}
                  />
                )}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="fig text-xl text-signal">
                {formatCents(slot.currentCents ?? slot.floorRateCents)}
              </p>
              <p className="meta">
                {slot.status}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
