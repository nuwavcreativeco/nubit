"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { followUser, unfollowUser } from "@/app/u/actions";

/**
 * Following is what turns a bell into first pick: the trigger on slots fans a
 * notification out to every follower the moment a day is posted.
 */
export default function FollowButton({
  userId,
  handle,
  following,
  followers,
}: {
  userId: string;
  handle: string;
  following: boolean;
  followers: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic, because the count sitting still for a round trip reads as a
  // dropped click.
  const [isFollowing, setIsFollowing] = useState(following);
  const [count, setCount] = useState(followers);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !isFollowing;
    setIsFollowing(next);
    setCount((c) => c + (next ? 1 : -1));
    setError(null);

    startTransition(async () => {
      const result = next
        ? await followUser(userId, handle)
        : await unfollowUser(userId, handle);

      if ("error" in result) {
        setIsFollowing(!next);
        setCount((c) => c + (next ? -1 : 1));
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        onClick={toggle}
        disabled={pending}
        className={
          isFollowing
            ? "btn-ghost h-10 px-6 text-sm disabled:opacity-60"
            : "btn-signal h-10 px-6 text-sm disabled:opacity-60"
        }
      >
        {isFollowing ? "Following" : "Follow"}
      </button>
      <span className="meta">
        {count.toLocaleString()} {count === 1 ? "follower" : "followers"}
      </span>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
