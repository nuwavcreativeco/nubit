"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import Countdown from "@/components/Countdown";
import { formatCents } from "@/lib/types";

export type FeedReel = {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string | null;
  aspect: string;
  durationSeconds: number | null;
  ownerId: string;
  ownerName: string;
  ownerHandle: string;
  ownerAvatarUrl: string | null;
  liveSlotId: string | null;
  liveClosesAt: string | null;
  liveCents: number | null;
};

function clock(seconds: number | null) {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The same feed for both sides of the market: work from the people you
 * follow. A shooter reads it as a peer feed, a creator as a shopping feed,
 * and a reel currently fronting an open day carries its price and clock.
 */
export default function ReelFeed({ reels }: { reels: FeedReel[] }) {
  return (
    <ul className="mt-8 space-y-px bg-line">
      {reels.map((reel) => (
        <li key={reel.id} className="bg-stage py-6">
          <div className="flex items-center gap-3">
            <Link href={`/u/${reel.ownerHandle}`}>
              <Avatar name={reel.ownerName} url={reel.ownerAvatarUrl} size={36} />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/u/${reel.ownerHandle}`}
                className="block truncate text-sm font-medium text-key transition hover:text-signal"
              >
                {reel.ownerName}
              </Link>
              <p className="meta truncate">@{reel.ownerHandle}</p>
            </div>
            {reel.liveSlotId && (
              <Link
                href={`/slots/${reel.liveSlotId}`}
                className="btn-signal flex h-9 shrink-0 items-center px-4 text-sm"
              >
                Bid
              </Link>
            )}
          </div>

          <div className="relative mt-4 border border-line bg-rack">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={reel.videoUrl}
              poster={reel.posterUrl ?? undefined}
              controls
              preload="none"
              className="w-full bg-rack-2"
              style={{ aspectRatio: reel.aspect === "9:16" ? "9 / 16" : "16 / 9" }}
            />
            <span className="meta pointer-events-none absolute left-2 top-2 flex items-center gap-1 text-key">
              <span className="pip" aria-hidden />
              {reel.aspect}
            </span>
            {reel.durationSeconds !== null && (
              <span className="meta pointer-events-none absolute right-2 top-2 text-key">
                {clock(reel.durationSeconds)}
              </span>
            )}
          </div>

          {reel.caption && <p className="mt-3 text-sm text-crew">{reel.caption}</p>}

          {reel.liveSlotId && reel.liveCents !== null && reel.liveClosesAt && (
            <Link
              href={`/slots/${reel.liveSlotId}`}
              className="mt-3 flex items-end justify-between border-t border-line pt-3 transition hover:opacity-80"
            >
              <span className="flex flex-col">
                <span className="label">Current</span>
                <span className="fig text-lg text-signal">
                  {formatCents(reel.liveCents)}
                </span>
              </span>
              <span className="flex flex-col items-end">
                <span className="label">Left</span>
                <Countdown
                  closesAt={reel.liveClosesAt}
                  className="fig text-lg"
                  closedLabel="closed"
                />
              </span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
