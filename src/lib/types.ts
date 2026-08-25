export type Role = "videographer" | "bidder";

export type Profile = {
  id: string;
  role: Role;
  display_name: string;
  city: string | null;
  created_at: string;
};

export type SlotStatus = "open" | "awarded" | "cancelled";

export type Slot = {
  id: string;
  videographer_id: string;
  title: string;
  shoot_date: string; // ISO date
  location: string;
  floor_rate_cents: number;
  description: string | null;
  status: SlotStatus;
  awarded_bid_id: string | null;
  created_at: string;
};

export type Bid = {
  id: string;
  slot_id: string;
  bidder_id: string;
  amount_cents: number;
  created_at: string;
};

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
