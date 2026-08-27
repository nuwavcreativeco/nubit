"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Avatar from "@/components/Avatar";
import Countdown from "@/components/Countdown";
import { formatCents } from "@/lib/types";
import {
  addComment,
  deleteComment,
  deleteReel,
  toggleLike,
  updateCaption,
} from "@/app/u/actions";

export type ReelView = {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string | null;
  aspect: string;
  durationSeconds: number | null;
  createdAt: string;
  ownerId: string;
  ownerName: string;
  ownerHandle: string;
  ownerAvatarUrl: string | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  isMine: boolean;
  liveSlotId: string | null;
  liveClosesAt: string | null;
  liveCents: number | null;
};

export type CommentView = {
  id: number;
  body: string;
  createdAt: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string | null;
  canDelete: boolean;
};

/**
 * Spelled-out units, because these render inside .meta which uppercases —
 * and "20M" reads as twenty months rather than twenty minutes.
 */
function ago(iso: string) {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"}`;
  const weeks = Math.floor(days / 7);
  return `${weeks} ${weeks === 1 ? "wk" : "wks"}`;
}

/**
 * One reel, in full. The same component backs the modal on a profile and the
 * standalone /r/<id> page, so a reel looks identical however you reach it.
 *
 * Laid out as video-beside-thread on desktop and stacked on mobile, which is
 * the shape Instagram settled on for good reason: the work stays visible
 * while you read what people said about it.
 */
export default function ReelDetail({
  reel,
  comments,
  signedIn,
  onClose,
}: {
  reel: ReelView;
  comments: CommentView[];
  signedIn: boolean;
  /** Present when shown as a modal. */
  onClose?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // The thread owns its own data. Inside the modal these arrive as a
  // snapshot taken when the tile was opened, and router.refresh() re-renders
  // the profile behind the modal without touching that snapshot — so a
  // posted comment appeared to vanish. Refetching here fixes both surfaces.
  const [thread, setThread] = useState(comments);
  const [liked, setLiked] = useState(reel.likedByMe);
  const [likes, setLikes] = useState(reel.likeCount);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(reel.caption ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setThread(comments), [comments]);

  useEffect(() => {
    setLiked(reel.likedByMe);
    setLikes(reel.likeCount);
    setCaption(reel.caption ?? "");
  }, [reel.likedByMe, reel.likeCount, reel.caption]);

  const reloadThread = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("reel_comments_for", { p_reel: reel.id });
    setThread(
      (data ?? []).map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        authorName: c.author_name,
        authorHandle: c.author_handle,
        authorAvatar: c.author_avatar,
        canDelete: c.can_delete,
      }))
    );
  }, [reel.id]);

  // Escape closes the modal, the way every lightbox should.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function like() {
    if (!signedIn) {
      setError("Sign in to like work.");
      return;
    }
    // Optimistic: a heart that waits for the server reads as a dropped tap.
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    startTransition(async () => {
      const result = await toggleLike(reel.id, next);
      if ("error" in result) {
        setLiked(!next);
        setLikes((n) => n + (next ? -1 : 1));
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitComment() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    setBody("");
    startTransition(async () => {
      const result = await addComment(reel.id, text);
      if ("error" in result) {
        setBody(text);
        setError(result.error);
        return;
      }
      await reloadThread();
      router.refresh();
      endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
  }

  function removeComment(id: number) {
    startTransition(async () => {
      const result = await deleteComment(id, reel.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      await reloadThread();
      router.refresh();
    });
  }

  function saveCaption() {
    startTransition(async () => {
      const result = await updateCaption(reel.id, caption);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function removeReel() {
    startTransition(async () => {
      const result = await deleteReel(reel.id, reel.ownerHandle);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (onClose) onClose();
      router.push(`/u/${reel.ownerHandle}`);
      router.refresh();
    });
  }

  const vertical = reel.aspect === "9:16";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border border-line bg-rack md:flex-row">
      {/* The work itself */}
      <div className="flex shrink-0 items-center justify-center bg-stage md:w-[58%]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={reel.videoUrl}
          poster={reel.posterUrl ?? undefined}
          controls
          autoPlay
          loop
          playsInline
          className="max-h-[50vh] w-full object-contain md:max-h-[82vh]"
          style={{ aspectRatio: vertical ? "9 / 16" : "16 / 9" }}
        />
      </div>

      {/* Who, what, and what people said */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Link href={`/u/${reel.ownerHandle}`} onClick={onClose}>
            <Avatar name={reel.ownerName} url={reel.ownerAvatarUrl} size={36} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={`/u/${reel.ownerHandle}`}
              onClick={onClose}
              className="block truncate text-sm font-medium text-key transition hover:text-signal"
            >
              {reel.ownerName}
            </Link>
            <p className="meta truncate">
              @{reel.ownerHandle} · {reel.aspect} · {ago(reel.createdAt)}
            </p>
          </div>

          {reel.isMine && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Reel options"
                className="px-2 text-crew transition hover:text-key"
              >
                ···
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-10 w-44 border border-line bg-rack-2">
                  <button
                    onClick={() => {
                      setEditing(true);
                      setMenuOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-key transition hover:bg-rack"
                  >
                    Edit caption
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDelete(true);
                      setMenuOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-sm text-red-400 transition hover:bg-rack"
                  >
                    Delete reel
                  </button>
                </div>
              )}
            </div>
          )}

          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="px-2 text-crew transition hover:text-key"
            >
              ✕
            </button>
          )}
        </header>

        {/* Caption reads as the first thing said about the work, then the
            thread — which is how Instagram orders it. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {editing ? (
            <div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Say something about this piece"
                className="w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={saveCaption}
                  disabled={pending}
                  className="btn-signal h-9 px-5 text-sm disabled:opacity-60"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setCaption(reel.caption ?? "");
                    setEditing(false);
                  }}
                  className="btn-ghost h-9 px-4 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            (reel.caption || reel.isMine) && (
              <div className="flex gap-3">
                <Avatar name={reel.ownerName} url={reel.ownerAvatarUrl} size={28} />
                <p className="flex-1 whitespace-pre-wrap text-sm text-key">
                  {reel.caption || (
                    <button
                      onClick={() => setEditing(true)}
                      className="text-crew underline transition hover:text-key"
                    >
                      Add a caption
                    </button>
                  )}
                </p>
              </div>
            )
          )}

          {thread.length === 0 ? (
            <p className="meta">No comments yet.</p>
          ) : (
            thread.map((c) => (
              <div key={c.id} className="group flex gap-3">
                <Link href={`/u/${c.authorHandle}`} onClick={onClose}>
                  <Avatar name={c.authorName} url={c.authorAvatar} size={28} />
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-key">
                    <Link
                      href={`/u/${c.authorHandle}`}
                      onClick={onClose}
                      className="font-medium transition hover:text-signal"
                    >
                      {c.authorName}
                    </Link>{" "}
                    <span className="whitespace-pre-wrap text-crew">{c.body}</span>
                  </p>
                  <p className="meta mt-1">{ago(c.createdAt)}</p>
                </div>
                {c.canDelete && (
                  <button
                    onClick={() => removeComment(c.id)}
                    disabled={pending}
                    aria-label="Delete comment"
                    className="meta shrink-0 text-crew opacity-0 transition hover:text-red-400 group-hover:opacity-100 disabled:opacity-40"
                  >
                    Delete
                  </button>
                )}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        {/* If this reel is fronting a live day, that is the thing to do next. */}
        {reel.liveSlotId && reel.liveCents !== null && reel.liveClosesAt && (
          <Link
            href={`/slots/${reel.liveSlotId}`}
            onClick={onClose}
            className="flex items-end justify-between border-t border-line px-4 py-3 transition hover:bg-rack-2"
          >
            <span className="flex flex-col">
              <span className="label">Bidding now</span>
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

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={like}
              disabled={pending}
              aria-label={liked ? "Unlike" : "Like"}
              className={`text-xl transition ${
                liked ? "text-signal" : "text-crew hover:text-key"
              }`}
            >
              {liked ? "♥" : "♡"}
            </button>
            <span className="meta">
              {likes} {likes === 1 ? "like" : "likes"} · {thread.length}{" "}
              {thread.length === 1 ? "comment" : "comments"}
            </span>
          </div>

          {signedIn ? (
            <div className="mt-3 flex gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComment();
                  }
                }}
                rows={1}
                placeholder="Add a comment"
                className="min-h-9 flex-1 resize-none border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
              />
              <button
                onClick={submitComment}
                disabled={pending || !body.trim()}
                className="btn-signal h-9 px-4 text-sm disabled:opacity-40"
              >
                Post
              </button>
            </div>
          ) : (
            <p className="meta mt-3">
              <Link href="/auth/sign-in" className="text-signal hover:text-key">
                Sign in
              </Link>{" "}
              to like or comment.
            </p>
          )}

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>

      {/* Deleting a reel is not undoable and can pull a live day's poster out
          from under it, so it asks first. */}
      {confirmDelete && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-stage/90 p-6">
          <div className="w-full max-w-sm border border-line bg-rack p-5">
            <p className="text-sm text-key">Delete this reel?</p>
            <p className="meta mt-2">
              It comes off your grid for good. Any open day fronted with it
              keeps running, just without the poster.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={removeReel}
                disabled={pending}
                className="h-9 flex-1 bg-red-500 text-sm font-medium text-stage transition hover:bg-red-400 disabled:opacity-60"
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="btn-ghost h-9 px-5 text-sm"
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
