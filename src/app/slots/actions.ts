"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createSlot(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Auth flow lands in the next build step — for now this keeps the
    // action honest about what it needs instead of failing silently.
    return { error: "You need to be signed in to post a slot." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const shoot_date = String(formData.get("shoot_date") ?? "");
  const location = String(formData.get("location") ?? "").trim();
  const floorRateDollars = Number(formData.get("floor_rate") ?? 0);
  const description = String(formData.get("description") ?? "").trim();

  if (!title || !shoot_date || !location || !(floorRateDollars > 0)) {
    return { error: "Fill in title, date, location, and a floor rate above $0." };
  }

  const { error } = await supabase.from("slots").insert({
    videographer_id: user.id,
    title,
    shoot_date,
    location,
    floor_rate_cents: Math.round(floorRateDollars * 100),
    description: description || null,
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/slots");
}

export async function cancelSlot(slotId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in." };
  }

  const { data: slot, error: slotError } = await supabase
    .from("slots")
    .select("id, status, videographer_id")
    .eq("id", slotId)
    .single();

  if (slotError || !slot) {
    return { error: "Slot not found." };
  }
  if (slot.videographer_id !== user.id) {
    return { error: "Only the videographer who posted this slot can cancel it." };
  }
  if (slot.status !== "open") {
    return { error: "This slot has already been decided." };
  }

  const { error } = await supabase
    .from("slots")
    .update({ status: "cancelled" })
    .eq("id", slotId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/slots/${slotId}`);
  revalidatePath("/slots/mine");
}
