import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ReelFeed, { type FeedReel } from "@/components/ReelFeed";

export default async function FeedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="text-2xl tracking-tight">Sign in to see your feed</h1>
        <p className="mt-3 text-crew">
          <Link href="/auth/sign-in" className="text-signal underline">
            Sign in
          </Link>{" "}
          to follow the people you shoot with and see their work here first.
        </p>
      </main>
    );
  }

  const { data: reels } = await supabase.rpc("reels_following", { p_limit: 40 });

  const items: FeedReel[] = (reels ?? []).map((row) => ({
    id: row.id,
    videoUrl: row.video_url,
    posterUrl: row.poster_url,
    caption: row.caption,
    aspect: row.aspect,
    durationSeconds: row.duration_seconds,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerHandle: row.owner_handle,
    ownerAvatarUrl: row.owner_avatar_url,
    liveSlotId: row.live_slot_id,
    liveClosesAt: row.live_closes_at,
    liveCents: row.live_cents,
  }));

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <h1 className="text-3xl tracking-tight">Feed</h1>
      <p className="meta mt-2">Work from the people you follow</p>

      {items.length === 0 ? (
        <div className="mt-10 border border-line bg-rack p-6">
          <p className="text-crew">
            Your feed is empty because you aren&apos;t following anyone yet.
          </p>
          <p className="mt-3 text-sm text-crew">
            Follow a videographer and their work shows up here — and you get the
            bell the moment they post an open day, before it reaches the board.
          </p>
          <Link
            href="/slots"
            className="btn-signal mt-5 inline-flex h-10 items-center px-6 text-sm"
          >
            Find people on the board
          </Link>
        </div>
      ) : (
        <ReelFeed reels={items} />
      )}
    </main>
  );
}
