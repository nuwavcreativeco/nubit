"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCountdown } from "@/lib/types";

/**
 * Ticks down to closes_at. close_due_slots() runs on a one-minute cron, so
 * when the clock runs out we wait a beat and refresh to pick up the settled
 * status rather than guessing at it client-side.
 */
export default function Countdown({
  closesAt,
  className,
  closedLabel = "closed",
}: {
  closesAt: string;
  className?: string;
  /** The site pairs the clock with its own LEFT label, so the bare value is
   *  the default and callers supply any surrounding words. */
  closedLabel?: string;
}) {
  const router = useRouter();
  const [msLeft, setMsLeft] = useState(() => Date.parse(closesAt) - Date.now());

  useEffect(() => {
    const target = Date.parse(closesAt);
    const id = setInterval(() => setMsLeft(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [closesAt]);

  useEffect(() => {
    if (msLeft > 0) return;
    const id = setTimeout(() => router.refresh(), 65_000);
    return () => clearTimeout(id);
  }, [msLeft, router]);

  return (
    <span className={className} suppressHydrationWarning>
      {msLeft > 0 ? formatCountdown(msLeft) : closedLabel}
    </span>
  );
}
