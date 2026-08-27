"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hideBookedTile } from "@/app/u/actions";
import { formatCents } from "@/lib/types";
import ReelDetail, {
  type CommentView,
  type ReelView,
} from "@/components/ReelDetail";

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
  bookedSlotId: string | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  liveSlotId: string | null;
  liveCents: number | null;
};

function clock(seconds: number | null) {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Square tiles regardless of the reel's own shape, because a grid of mixed
 * 9:16 and 16:9 reads as broken rather than varied. The shape is still
 * labelled on the tile, and the reel plays back at its true aspect.
 */
export default function ProfileGrid({
  tiles,
  handle,
  isOwner,
  signedIn,
}: {
  tiles: GridTile[];
  handle: string;
  isOwner: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{
    reel: ReelView;
    comments: CommentView[];
  } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The modal fetches the full record on open rather than the grid carrying
  // every comment for every tile up front.
  const openTile = useCallback(
    async (id: string) => {
      setLoading(id);
      const supabase = createClient();
      const [{ data: rows }, { data: comments }] = await Promise.all([
        supabase.rpc("reel_detail", { p_reel: id }),
        supabase.rpc("reel_comments_for", { p_reel: id }),
      ]);
      setLoading(null);

      const row = rows?.[0];
      if (!row) return;

      setOpen({
        reel: {
          id: row.id,
          videoUrl: row.video_url,
          posterUrl: row.poster_url,
          caption: row.caption,
          aspect: row.aspect,
          durationSeconds: row.duration_seconds,
          createdAt: row.created_at,
          ownerId: row.owner_id,
          ownerName: row.owner_name,
          ownerHandle: row.owner_handle,
          ownerAvatarUrl: row.owner_avatar_url,
          likeCount: row.like_count,
          commentCount: row.comment_count,
          likedByMe: row.liked_by_me,
          isMine: row.is_mine,
          liveSlotId: row.live_slot_id,
          liveClosesAt: row.live_closes_at,
          liveCents: row.live_cents,
        },
        comments: (comments ?? []).map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.created_at,
          authorName: c.author_name,
          authorHandle: c.author_handle,
          authorAvatar: c.author_avatar,
          canDelete: c.can_delete,
        })),
      });
    },
    []
  );

  async function hide(slotId: string) {
    setBusy(slotId);
    await hideBookedTile(slotId, true, handle);
    setBusy(null);
    router.refresh();
  }

  if (tiles.length === 0) {
    return (
      <p className="mt-10 text-crew">
        {isOwner
          ? "Nothing here yet. Add a reel above and it becomes the first tile on your grid."
          : "No work on this profile yet."}
      </p>
    );
  }

  return (
    <>
      <ul className="mt-8 grid grid-cols-3 gap-1">
        {tiles.map((tile) => (
          <li key={`${tile.source}-${tile.id}`} className="group relative">
            <button
              onClick={() => void openTile(tile.id)}
              data-reel-id={tile.id}
              className="block w-full"
              aria-label={tile.caption ?? "Open reel"}
            >
              <span className="relative block aspect-square w-full overflow-hidden bg-rack-2">
                {tile.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tile.posterUrl}
                    alt={tile.caption ?? ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-crew">
                    ▶
                  </span>
                )}

                <span className="meta absolute left-1.5 top-1.5 flex items-center gap-1 text-key">
                  <span className="pip" aria-hidden />
                  {tile.aspect}
                </span>

                {tile.durationSeconds !== null && (
                  <span className="meta absolute bottom-1.5 right-1.5 text-key">
                    {clock(tile.durationSeconds)}
                  </span>
                )}

                {/* Engagement on hover, the way a grid tile shows it. */}
                <span className="absolute inset-0 flex items-center justify-center gap-5 bg-stage/70 opacity-0 transition group-hover:opacity-100">
                  <span className="text-sm font-medium text-key">
                    {tile.likedByMe ? "♥" : "♡"} {tile.likeCount}
                  </span>
                  <span className="text-sm font-medium text-key">
                    ✎ {tile.commentCount}
                  </span>
                </span>

                {loading === tile.id && (
                  <span className="meta absolute inset-0 flex items-center justify-center bg-stage/80 text-key">
                    Opening…
                  </span>
                )}
              </span>
            </button>

            {/* A live day fronted by this reel gets its price on the tile. */}
            {tile.liveSlotId && tile.liveCents !== null && (
              <Link
                href={`/slots/${tile.liveSlotId}`}
                className="meta absolute bottom-1.5 left-1.5 bg-stage/80 px-1.5 py-0.5 text-signal"
              >
                {formatCents(tile.liveCents)}
              </Link>
            )}

            {/* Work someone else shot, sitting on this profile because it was
                delivered here. Credit stays with the shooter. */}
            {tile.source === "booked" && tile.creditName && (
              <p className="meta mt-1 truncate">
                <Link
                  href={`/u/${tile.creditHandle}`}
                  className="text-signal hover:text-key"
                >
                  {tile.creditName}
                </Link>
                {isOwner && tile.bookedSlotId && (
                  <>
                    {" · "}
                    <button
                      onClick={() => void hide(tile.bookedSlotId!)}
                      disabled={busy === tile.bookedSlotId}
                      className="text-crew underline transition hover:text-key disabled:opacity-60"
                    >
                      Hide
                    </button>
                  </>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stage/95 p-4 md:p-8"
          onClick={() => setOpen(null)}
        >
          <div
            className="relative max-h-full w-full max-w-5xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <ReelDetail
              reel={open.reel}
              comments={open.comments}
              signedIn={signedIn}
              onClose={() => {
                setOpen(null);
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
