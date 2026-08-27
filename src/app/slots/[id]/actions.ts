"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BidOutcome } from "@/lib/types";

type ActionResult = { error: string } | { outcome: BidOutcome };

/**
 * Bidding goes through place_bid() rather than an insert: the function holds
 * a row lock while it works out the proxy price, enforces the step/floor/
 * claim bounds, and extends closes_at when a bid lands inside the last five
 * minutes. Clients have no INSERT policy on bids at all.
 */
export async function placeBid(
  slotId: string,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in to bid." };
  }

  const maxDollars = Number(formData.get("max") ?? 0);
  if (!Number.isFinite(maxDollars) || maxDollars <= 0) {
    return { error: "Enter a maximum above $0." };
  }

  const { data, error } = await supabase.rpc("place_bid", {
    p_slot: slotId,
    p_max_cents: Math.round(maxDollars * 100),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/slots/${slotId}`);
  revalidatePath("/bids/mine");
  return { outcome: data as unknown as BidOutcome };
}

/** Buy-it-now at the slot's claim price — ends the auction immediately. */
export async function claimSlot(slotId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in to claim a day." };
  }

  const { data, error } = await supabase.rpc("claim_slot", { p_slot: slotId });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/slots/${slotId}`);
  revalidatePath("/bids/mine");
  return { outcome: data as unknown as BidOutcome };
}
