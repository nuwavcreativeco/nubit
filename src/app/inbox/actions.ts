"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string } | { ok: true };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function sendMessage(
  conversationId: string,
  body: string
): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in to send a message." };

  const text = body.trim();
  if (!text) return { error: "Write something first." };
  if (text.length > 4000) return { error: "That message is too long." };

  // The insert policy checks membership; the trigger bumps the thread and
  // rings the other side.
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: text,
  });
  if (error) return { error: error.message };

  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return { ok: true };
}

export async function markThreadRead(conversationId: string): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in first." };

  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conv: conversationId,
  });
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * A direct offer. Accepting it books a real slot, which is what keeps the
 * deal on the ledger — and therefore reviewable and countable — instead of
 * ending as a handshake in a thread.
 */
export async function sendOffer(input: {
  toUserId: string;
  title: string;
  location: string;
  shootDate: string;
  priceCents: number;
  expiresAt: string;
  reelId?: string | null;
  note?: string | null;
  areaLabel?: string | null;
}): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in to send an offer." };

  if (!input.title.trim()) return { error: "Give the day a title." };
  if (!input.location.trim()) return { error: "Say where it is." };
  if (!Number.isFinite(input.priceCents) || input.priceCents <= 0) {
    return { error: "Enter a price." };
  }
  if (input.priceCents % 100 !== 0) {
    return { error: "Offers are in whole dollars." };
  }

  const { error } = await supabase.rpc("send_offer", {
    p_to: input.toUserId,
    p_title: input.title.trim(),
    p_location: input.location.trim(),
    p_shoot_date: input.shootDate,
    p_price_cents: input.priceCents,
    p_expires_at: input.expiresAt,
    p_reel: input.reelId ?? undefined,
    p_note: input.note?.trim() || undefined,
    p_area_label: input.areaLabel?.trim() || undefined,
  });
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return { ok: true };
}

export async function respondToOffer(
  offerId: string,
  accept: boolean
): Promise<Result & { slotId?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in first." };

  const { data, error } = await supabase.rpc("respond_to_offer", {
    p_offer: offerId,
    p_accept: accept,
  });
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  revalidatePath("/slots/mine");
  revalidatePath("/bids/mine");

  const result = data as { outcome?: string; slot_id?: string } | null;
  return { ok: true, slotId: result?.slot_id };
}

export async function withdrawOffer(offerId: string): Promise<Result> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sign in first." };

  const { error } = await supabase.rpc("withdraw_offer", { p_offer: offerId });
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return { ok: true };
}
