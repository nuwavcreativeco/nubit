"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string } | { ok: true };

function validCoords(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Saves where the bidder is searching from. The RPC fuzzes the point to
 * ~1km before it ever touches a column, so what lands in profiles.geog_approx
 * is deliberately too coarse to place anyone at an address.
 */
export async function saveMyLocation(lat: number, lng: number): Promise<Result> {
  if (!validCoords(lat, lng)) return { error: "That doesn't look like a valid location." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to save your location." };

  const { error } = await supabase.rpc("set_profile_location", {
    p_lat: lat,
    p_lng: lng,
  });
  if (error) return { error: error.message };

  revalidatePath("/slots");
  return { ok: true };
}

export async function saveSearchRadius(miles: number): Promise<Result> {
  if (!Number.isFinite(miles) || miles < 1 || miles > 500) {
    return { error: "Pick a radius between 1 and 500 miles." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to save a search radius." };

  const { error } = await supabase
    .from("profiles")
    .update({ search_radius_mi: Math.round(miles) })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/slots");
  return { ok: true };
}

/**
 * Pins a slot to a point. set_slot_location() stores the exact coordinates in
 * slot_locations (readable only by the videographer, and by the winner once
 * there's a deal) and a fuzzed copy on the slot itself for radius search.
 * It refuses once anyone has bid — the location can't move under bidders.
 */
export async function saveSlotLocation(
  slotId: string,
  lat: number,
  lng: number,
  address?: string
): Promise<Result> {
  if (!validCoords(lat, lng)) return { error: "That doesn't look like a valid location." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to set a slot's location." };

  const { error } = await supabase.rpc("set_slot_location", {
    p_slot: slotId,
    p_lat: lat,
    p_lng: lng,
    p_address: address,
  });
  if (error) return { error: error.message };

  revalidatePath("/slots");
  revalidatePath("/slots/mine");
  revalidatePath(`/slots/${slotId}`);
  return { ok: true };
}
