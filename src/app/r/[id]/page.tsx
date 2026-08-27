import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReelDetail, {
  type CommentView,
  type ReelView,
} from "@/components/ReelDetail";

async function loadReel(id: string) {
  const supabase = await createClient();
  const [{ data: rows }, { data: comments }, { data: auth }] = await Promise.all([
    supabase.rpc("reel_detail", { p_reel: id }),
    supabase.rpc("reel_comments_for", { p_reel: id }),
    supabase.auth.getUser(),
  ]);
  return { row: rows?.[0] ?? null, comments: comments ?? [], user: auth.user };
}

/**
 * A reel pasted into a DM or a story should unfurl with the poster frame and
 * the shooter's name. That is most of why the permalink exists at all.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { row } = await loadReel(id);
  if (!row) return { title: "Reel not found — NuBid" };

  const title = `${row.owner_name} on NuBid`;
  const description = row.caption ?? `Work by ${row.owner_name} (@${row.owner_handle})`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "video.other",
      images: row.poster_url ? [{ url: row.poster_url }] : undefined,
      videos: [{ url: row.video_url }],
    },
    twitter: {
      card: "player",
      title,
      description,
      images: row.poster_url ? [row.poster_url] : undefined,
    },
  };
}

export default async function ReelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { row, comments, user } = await loadReel(id);

  if (!row) notFound();

  const reel: ReelView = {
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
  };

  const thread: CommentView[] = comments.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    authorName: c.author_name,
    authorHandle: c.author_handle,
    authorAvatar: c.author_avatar,
    canDelete: c.can_delete,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <Link
        href={`/u/${reel.ownerHandle}`}
        className="meta text-crew transition hover:text-key"
      >
        ← {reel.ownerName}&apos;s grid
      </Link>

      <div className="relative mt-4">
        <ReelDetail reel={reel} comments={thread} signedIn={Boolean(user)} />
      </div>
    </main>
  );
}
