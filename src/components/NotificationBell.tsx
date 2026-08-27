"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/types";

export type Bell = {
  id: number;
  kind: string;
  slotId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  read: boolean;
};

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function num(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" ? value : null;
}

/** What a notification says, and where it takes you. */
function render(bell: Bell): { text: string; href: string } {
  const p = bell.payload;
  const who = str(p, "videographer_name") || str(p, "sender_name") || str(p, "from_name") || str(p, "by_name");
  const title = str(p, "title");
  const conv = str(p, "conversation_id");
  const price = num(p, "price_cents");

  switch (bell.kind) {
    case "followed_posted":
      return {
        text: `${who} posted ${title} — you're seeing it first`,
        href: bell.slotId ? `/slots/${bell.slotId}` : "/feed",
      };
    case "message":
      return {
        text: `${who}: ${str(p, "preview")}`,
        href: conv ? `/inbox/${conv}` : "/inbox",
      };
    case "offer_received":
      return {
        text: `${who} offered you ${title}${price !== null ? ` for ${formatCents(price)}` : ""}`,
        href: conv ? `/inbox/${conv}` : "/inbox",
      };
    case "offer_accepted":
      return { text: `${who} accepted your offer for ${title}`, href: bell.slotId ? `/slots/${bell.slotId}` : "/inbox" };
    case "offer_declined":
      return { text: `${who} declined your offer for ${title}`, href: "/inbox" };
    case "offer_withdrawn":
      return { text: `An offer for ${title} was withdrawn`, href: "/inbox" };
    case "delivered":
      return { text: `${who} delivered the cut from ${title}`, href: bell.slotId ? `/slots/${bell.slotId}` : "/" };
    case "outbid":
      return { text: `You were outbid on ${title}`, href: bell.slotId ? `/slots/${bell.slotId}` : "/bids/mine" };
    case "won":
      return { text: `You won ${title}`, href: bell.slotId ? `/slots/${bell.slotId}` : "/bids/mine" };
    case "sold":
    case "sold_claim":
      return { text: `${title} sold`, href: bell.slotId ? `/slots/${bell.slotId}` : "/slots/mine" };
    case "lost":
      return { text: `${title} went to another bidder`, href: "/bids/mine" };
    case "expired":
      return { text: `${title} closed with no bids`, href: "/slots/mine" };
    case "claimed":
      return { text: `${title} was claimed outright`, href: bell.slotId ? `/slots/${bell.slotId}` : "/slots/mine" };
    default:
      return { text: title || "Something happened", href: "/" };
  }
}

function ago(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function NotificationBell({
  initialBells,
  initialUnread,
  userId,
}: {
  initialBells: Bell[];
  initialUnread: number;
  userId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bells, setBells] = useState(initialBells);
  const [unread, setUnread] = useState(initialUnread);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBells(initialBells);
    setUnread(initialUnread);
  }, [initialBells, initialUnread]);

  // A new day from someone you follow should land without a refresh — that
  // immediacy is the whole point of "first pick".
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bells:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, router]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || unread === 0) return;

    const ids = bells.filter((b) => !b.read).map((b) => b.id);
    if (ids.length === 0) return;

    setUnread(0);
    setBells((list) => list.map((b) => ({ ...b, read: true })));
    const supabase = createClient();
    await supabase.rpc("mark_notifications_read", { p_ids: ids });
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => void toggle()}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative flex h-8 w-8 items-center justify-center text-crew transition hover:text-key"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center bg-signal px-1 text-[10px] font-semibold text-stage">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[22rem] max-w-[92vw] border border-line bg-rack">
          <p className="label border-b border-line px-4 py-3">Notifications</p>

          {bells.length === 0 ? (
            <p className="px-4 py-6 text-sm text-crew">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {bells.map((bell) => {
                const { text, href } = render(bell);
                return (
                  <li key={bell.id}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`flex items-start gap-3 px-4 py-3 transition hover:bg-rack-2 ${
                        bell.read ? "" : "border-l-2 border-signal"
                      }`}
                    >
                      <span className="flex-1 text-sm text-key">{text}</span>
                      <span className="meta shrink-0">{ago(bell.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
