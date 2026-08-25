"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatCents, type SlotStatus } from "@/lib/types";

type LiveSlot = {
  id: string;
  title: string;
  shootDate: string;
  location: string;
  floorRateCents: number;
  status: SlotStatus;
  bidCount: number;
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
    const slotIds = initialSlots.map((s) => s.id);

    const channel = supabase.channel(`my-slots:${videographerId}`).on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "slots",
        filter: `videographer_id=eq.${videographerId}`,
      },
      (payload) => {
        const row = payload.new as { id: string; status: SlotStatus };
        setSlots((prev) => prev.map((s) => (s.id === row.id ? { ...s, status: row.status } : s)));
      }
    );

    if (slotIds.length > 0) {
      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `slot_id=in.(${slotIds.join(",")})`,
        },
        (payload) => {
          const row = payload.new as { slot_id: string };
          setSlots((prev) =>
            prev.map((s) => (s.id === row.slot_id ? { ...s, bidCount: s.bidCount + 1 } : s))
          );
        }
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // Subscribe once for the slots this page loaded with — a slot posted
    // after mount won't be covered until the next full page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videographerId]);

  if (slots.length === 0) {
    return (
      <p className="mt-8 text-ink-dim">
        You haven&apos;t posted a slot yet.{" "}
        <Link href="/slots/new" className="text-brass underline">
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
            className="flex items-center justify-between py-5 transition hover:opacity-80"
          >
            <div>
              <p className="font-display text-lg">{slot.title}</p>
              <p className="mt-1 text-sm text-ink-dim">
                {new Date(slot.shootDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                &middot; {slot.location} &middot; {slot.bidCount}{" "}
                {slot.bidCount === 1 ? "bid" : "bids"}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-brass">{formatCents(slot.floorRateCents)}</p>
              <p className="text-xs uppercase tracking-widest text-ink-dim">{slot.status}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
