"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string } | { ok: true };

export const ASPECTS = ["16:9", "9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Following is a plain row, not an RPC: the follows policies already pin
 * follower_id to the caller, so the insert is safe on its own. The bell that
 * fires when this person posts a day is a database trigger, so nothing here
 * has to remember to schedule it.
 */
export async function followUser(userId: string, handle: string): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in to follow." };
  if (user.id === userId) return { error: "You can't follow yourself." };

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, followee_id: userId });

  // Following twice is not an error worth showing anyone.
  if (error && error.code !== "23505") return { error: error.message };

  revalidatePath(`/u/${handle}`);
  revalidatePath("/feed");
  return { ok: true };
}

export async function unfollowUser(userId: string, handle: string): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in to unfollow." };

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("followee_id", userId);
  if (error) return { error: error.message };

  revalidatePath(`/u/${handle}`);
  revalidatePath("/feed");
  return { ok: true };
}

/**
 * Records a reel after the file itself has gone straight from the browser to
 * Storage. Sending a 500MB video through a server action would be a waste of
 * a round trip and would blow the body limit besides.
 */
export async function createReel(input: {
  videoUrl: string;
  posterUrl?: string | null;
  caption?: string | null;
  aspect: Aspect;
  durationSeconds?: number | null;
}): Promise<Result & { id?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in to add work." };

  if (!input.videoUrl) return { error: "That upload didn't finish." };
  if (!ASPECTS.includes(input.aspect)) return { error: "Pick 16:9 or 9:16." };

  const { data, error } = await supabase
    .from("reels")
    .insert({
      owner_id: user.id,
      video_url: input.videoUrl,
      poster_url: input.posterUrl ?? null,
      caption: input.caption?.trim() || null,
      aspect: input.aspect,
      duration_seconds: input.durationSeconds ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { data: profile } = await supabase
    .from("profiles")
    .select("handle")
    .eq("id", user.id)
    .single();
  if (profile) revalidatePath(`/u/${profile.handle}`);
  revalidatePath("/feed");

  return { ok: true, id: data.id };
}

export async function deleteReel(reelId: string, handle: string): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in first." };

  // slots.reel_id and delivered_reel_id are both ON DELETE SET NULL, so a
  // live auction never disappears with the reel it was fronted with.
  const { error } = await supabase
    .from("reels")
    .delete()
    .eq("id", reelId)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };

  revalidatePath(`/u/${handle}`);
  return { ok: true };
}

export async function saveAvatar(avatarUrl: string): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in first." };

  const { data: profile, error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id)
    .select("handle")
    .single();
  if (error) return { error: error.message };

  revalidatePath(`/u/${profile.handle}`);
  return { ok: true };
}

export async function updateProfile(input: {
  displayName: string;
  bio?: string | null;
  city?: string | null;
}): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in first." };

  const displayName = input.displayName.trim();
  if (!displayName) return { error: "A display name is required." };
  if (displayName.length > 80) return { error: "That name is too long." };

  const { data: profile, error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      bio: input.bio?.trim() || null,
      city: input.city?.trim() || null,
    })
    .eq("id", user.id)
    .select("handle")
    .single();
  if (error) return { error: error.message };

  revalidatePath(`/u/${profile.handle}`);
  return { ok: true };
}

/** Opens (or reuses) a thread and hands back its id for the inbox to route to. */
export async function messageUser(userId: string): Promise<Result & { id?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in to send a message." };

  const { data, error } = await supabase.rpc("start_conversation", { p_user: userId });
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return { ok: true, id: data as string };
}
