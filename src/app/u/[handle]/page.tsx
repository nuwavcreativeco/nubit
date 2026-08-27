import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Avatar from "@/components/Avatar";
import AvatarUploader from "@/components/AvatarUploader";
import ReelUploader from "@/components/ReelUploader";
import FollowButton from "@/components/FollowButton";
import MessageButton from "@/components/MessageButton";
import ProfileGrid, { type GridTile } from "@/components/ProfileGrid";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, handle, bio, city, role, avatar_url")
    .eq("handle", handle.toLowerCase())
    .maybeSingle();

  if (!profile) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = user?.id === profile.id;

  const [{ data: counts }, { data: stats }, { data: grid }, { data: following }] =
    await Promise.all([
      supabase
        .from("follow_counts")
        .select("followers, following")
        .eq("id", profile.id)
        .maybeSingle(),
      supabase
        .from("videographer_stats")
        .select("rating, review_count, shoots_completed")
        .eq("id", profile.id)
        .maybeSingle(),
      supabase.rpc("profile_grid", { p_handle: profile.handle }),
      user && !isOwner
        ? supabase.rpc("is_following", { p_user: profile.id })
        : Promise.resolve({ data: false }),
    ]);

  const tiles: GridTile[] = (grid ?? []).map((row) => ({
    id: row.id,
    videoUrl: row.video_url,
    posterUrl: row.poster_url,
    caption: row.caption,
    aspect: row.aspect,
    durationSeconds: row.duration_seconds,
    source: row.source,
    creditName: row.credit_name,
    creditHandle: row.credit_handle,
    liveSlotId: row.live_slot_id,
    liveCents: row.live_cents,
  }));

  const shoots = tiles.filter((t) => t.source === "own").length;
  const booked = tiles.filter((t) => t.source === "booked").length;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
      <header className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col items-start gap-2">
          <Avatar name={profile.display_name} url={profile.avatar_url} size={96} />
          {isOwner && <AvatarUploader userId={profile.id} />}
        </div>

        <div className="min-w-60 flex-1">
          <h1 className="text-3xl tracking-tight">{profile.display_name}</h1>
          <p className="meta mt-1">
            @{profile.handle}
            {profile.city ? ` · ${profile.city}` : ""}
            {stats?.rating ? ` · ★ ${stats.rating}` : ""}
          </p>

          {profile.bio && <p className="mt-4 max-w-xl text-crew">{profile.bio}</p>}

          <div className="mt-4 flex flex-wrap gap-6">
            <span className="flex flex-col">
              <span className="fig text-lg">{counts?.followers ?? 0}</span>
              <span className="label">Followers</span>
            </span>
            <span className="flex flex-col">
              <span className="fig text-lg">{counts?.following ?? 0}</span>
              <span className="label">Following</span>
            </span>
            <span className="flex flex-col">
              <span className="fig text-lg">{shoots}</span>
              <span className="label">Reels</span>
            </span>
            {booked > 0 && (
              <span className="flex flex-col">
                <span className="fig text-lg">{booked}</span>
                <span className="label">Booked</span>
              </span>
            )}
          </div>
        </div>

        {!isOwner && user && (
          <div className="flex flex-col items-start gap-3">
            <FollowButton
              userId={profile.id}
              handle={profile.handle}
              following={Boolean(following)}
              followers={counts?.followers ?? 0}
            />
            <MessageButton userId={profile.id} />
          </div>
        )}

        {!user && (
          <Link href="/auth/sign-in" className="btn-signal flex h-10 items-center px-6 text-sm">
            Sign in to follow
          </Link>
        )}
      </header>

      {isOwner && (
        <div className="mt-10">
          <ReelUploader userId={profile.id} />
        </div>
      )}

      <ProfileGrid tiles={tiles} handle={profile.handle} isOwner={isOwner} />
    </main>
  );
}
