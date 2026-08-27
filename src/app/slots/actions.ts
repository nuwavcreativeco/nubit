"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/types";

function toCents(value: FormDataEntryValue | null): number {
  return Math.round(Number(value ?? 0) * 100);
}

function toList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type CreateResult = { error: string } | { slotId: string };

export async function createSlot(formData: FormData): Promise<CreateResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in to post a slot." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const shoot_date = String(formData.get("shoot_date") ?? "");
  const location = String(formData.get("location") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const starts_at = String(formData.get("starts_at") ?? "10:00");
  const ends_at = String(formData.get("ends_at") ?? "18:00");
  const radius_mi = Number(formData.get("radius_mi") ?? 25);
  // The form converts its datetime-local field to an ISO instant in the
  // browser, so the close time means what the poster saw, not what the
  // server's clock thinks.
  const closes_at = String(formData.get("closes_at_iso") ?? "");

  const floor_rate_cents = toCents(formData.get("floor_rate"));
  const step_cents = toCents(formData.get("step"));
  const claim_cents = toCents(formData.get("claim"));

  if (!title || !shoot_date || !location) {
    return { error: "Fill in a title, a shoot date, and a location." };
  }
  if (!(floor_rate_cents > 0) || !(step_cents > 0) || !(claim_cents > 0)) {
    return { error: "Floor, step, and claim price all need to be above $0." };
  }
  if (claim_cents <= floor_rate_cents) {
    return { error: "The claim price has to be above the floor day rate." };
  }
  // place_bid() only accepts step-aligned maxes between the floor and the
  // claim price. If those two aren't themselves on the step, the very first
  // bid is impossible and the slot sits dead until it expires.
  if (floor_rate_cents % step_cents !== 0 || claim_cents % step_cents !== 0) {
    return {
      error: `Floor and claim price both need to land on the ${formatCents(
        step_cents
      )} step.`,
    };
  }
  if (!closes_at || Number.isNaN(Date.parse(closes_at))) {
    return { error: "Pick when bidding closes." };
  }
  if (Date.parse(closes_at) <= Date.now()) {
    return { error: "Bidding has to close some time in the future." };
  }
  if (Date.parse(closes_at) > Date.parse(`${shoot_date}T${starts_at}:00Z`) + 86_400_000) {
    return { error: "Bidding should close before the shoot, not after it." };
  }

  // Returns the id so the caller can pin the slot's location straight after,
  // in the same flow, while the poster is still standing there.
  const { data: created, error } = await supabase
    .from("slots")
    .insert({
      videographer_id: user.id,
      title,
      shoot_date,
      starts_at,
      ends_at,
      location,
      radius_mi: Number.isFinite(radius_mi) ? radius_mi : 25,
      floor_rate_cents,
      step_cents,
      claim_cents,
      closes_at,
      delivers: toList(formData.get("delivers")),
      gear: toList(formData.get("gear")),
      description: description || null,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/slots");
  revalidatePath("/slots/mine");
  return { slotId: created.id };
}

export async function cancelSlot(slotId: string, reason?: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You need to be signed in." };
  }

  // A direct status update is refused by the guard_slot_writes trigger
  // ("use cancel_slot() to cancel"). The RPC does the ownership and status
  // checks itself and records who cancelled, when, and out of which state.
  const { error } = await supabase.rpc("cancel_slot", {
    p_slot: slotId,
    p_reason: reason || undefined,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/slots/${slotId}`);
  revalidatePath("/slots/mine");
}
