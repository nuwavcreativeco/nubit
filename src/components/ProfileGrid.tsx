"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteReel } from "@/app/u/actions";
import { formatCents } from "@/lib/types";

export type GridTile = {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string | null;
  aspect: string;
  durationSeconds: number | null;
  source: string;
  creditName: string | null;
  creditHandle: string | null;
  liveSlotId: string | null;
  liveCents: number | null;
};

function clock(seconds: number | null) {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ProfileGrid({
  tiles,
  handle,
  isOwner,
}: {
  tiles: GridTile[];
  handle: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [playing, setPlaying] = useState<GridTile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (tiles.length === 0) {
    return (
      <p className="mt-10 text-crew">
        {isOwner
          ? "Nothing here yet. Add a reel above and it becomes the first tile on your grid."
          : "No work on this profile yet."}
      </p>
    );
  }

  async function remove(id: string) {
    setBusy(id);
    await deleteReel(id, handle);
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      <ul className="mt-8 grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
        {tiles.map((tile) => (
          <li key={`${tile.source}-${tile.id}`} className="relative bg-rack">
            <button
              onClick={() => setPlaying(tile)}
              className="group block w-full text-left"
            >
              <span
                className="relative block w-full overflow-hidden bg-rack-2"
                style={{ aspectRatio: tile.aspect === "9:16" ? "9 / 16" : "16 / 9" }}
              >
                {tile.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tile.posterUrl}
                    alt={tile.caption ?? "Reel"}
                    className="h-full w-full object-cover transition group-hover:opacity-80"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-crew">
                    ▶
                  </span>
                )}

                <span className="meta absolute left-2 top-2 flex items-center gap-1 text-key">
                  <span className="pip" aria-hidden />
                  {tile.aspect}
                </span>

                {tile.durationSeconds !== null && (
                  <span className="meta absolute bottom-2 right-2 text-key">
                    {clock(tile.durationSeconds)}
                  </span>
                )}

                <span className="meta absolute bottom-2 left-2 text-rec">REC</span>
              </span>
            </button>

            {/* A tile on someone else's grid because they were shot for it. */}
            {tile.source === "booked" && tile.creditName && (
              <p className="meta px-2 py-2">
                Shot by{" "}
                <Link
                  href={`/u/${tile.creditHandle}`}
                  className="text-signal hover:text-key"
                >
                  {tile.creditName}
                </Link>
              </p>
            )}

            {/* A reel currently fronting an open day gets its price on it. */}
            {tile.liveSlotId && tile.liveCents !== null && (
              <Link
                href={`/slots/${tile.liveSlotId}`}
                className="flex items-baseline justify-between px-2 py-2 transition hover:bg-rack-2"
              >
                <span className="label">Bidding now</span>
                <span className="fig text-sm text-signal">
                  {formatCents(tile.liveCents)}
                </span>
              </Link>
            )}

            {isOwner && tile.source === "own" && (
              <button
                onClick={() => void remove(tile.id)}
                disabled={busy === tile.id}
                className="meta absolute right-2 top-2 text-crew transition hover:text-red-400 disabled:opacity-60"
              >
                {busy === tile.id ? "…" : "Remove"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {playing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stage/95 p-6"
          onClick={() => setPlaying(null)}
        >
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={playing.videoUrl}
              poster={playing.posterUrl ?? undefined}
              controls
              autoPlay
              className="max-h-[80vh] w-full bg-rack"
            />
            <div className="mt-3 flex items-start justify-between gap-4">
              <p className="text-sm text-crew">{playing.caption}</p>
              <button
                onClick={() => setPlaying(null)}
                className="meta shrink-0 text-crew hover:text-key"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
