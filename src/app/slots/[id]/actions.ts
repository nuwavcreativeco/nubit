"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/types";

export async function placeBid(slotId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in to bid." };
  }

  const amountDollars = Number(formData.get("amount") ?? 0);
  if (!(amountDollars > 0)) {
    return { error: "Enter a bid amount above $0." };
  }
  const amountCents = Math.round(amountDollars * 100);

  const { data: slot, error: slotError } = await supabase
    .from("slots")
    .select("id, status, videographer_id, floor_rate_cents")
    .eq("id", slotId)
    .single();

  if (slotError || !slot) {
    return { error: "Slot not found." };
  }
  if (slot.status !== "open") {
    return { error: "This slot isn't open for bidding." };
  }
  if (slot.videographer_id === user.id) {
    return { error: "You can't bid on your own slot." };
  }

  const { data: highBid } = await supabase
    .from("bids")
    .select("amount_cents")
    .eq("slot_id", slotId)
    .order("amount_cents", { ascending: false })
    .limit(1)
    .maybeSingle();

  const minCents = highBid?.amount_cents ?? slot.floor_rate_cents;
  if (amountCents <= minCents) {
    return { error: `Your bid needs to beat ${formatCents(minCents)}.` };
  }

  const { error } = await supabase.from("bids").insert({
    slot_id: slotId,
    bidder_id: user.id,
    amount_cents: amountCents,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/slots/${slotId}`);
}

export async function awardBid(slotId: string, bidId: string) {
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
    return { error: "Only the videographer who posted this slot can award it." };
  }
  if (slot.status !== "open") {
    return { error: "This slot has already been decided." };
  }

  const { data: bid, error: bidError } = await supabase
    .from("bids")
    .select("id, slot_id")
    .eq("id", bidId)
    .single();

  if (bidError || !bid || bid.slot_id !== slotId) {
    return { error: "That bid doesn't belong to this slot." };
  }

  const { error } = await supabase
    .from("slots")
    .update({ status: "awarded", awarded_bid_id: bidId })
    .eq("id", slotId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/slots/${slotId}`);
}
