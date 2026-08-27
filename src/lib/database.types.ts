// Generated from the live Supabase project (ekhmpsamdiwlgnajxfpz).
// Regenerate after every migration — this file is what stops the app from
// drifting away from the database again:
//   npx supabase gen types typescript --project-id ekhmpsamdiwlgnajxfpz > src/lib/database.types.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      bids: {
        Row: {
          bidder_id: string
          created_at: string
          id: string
          max_cents: number
          slot_id: string
        }
        Insert: {
          bidder_id: string
          created_at?: string
          id?: string
          max_cents: number
          slot_id: string
        }
        Update: {
          bidder_id?: string
          created_at?: string
          id?: string
          max_cents?: number
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      no_show_reports: {
        Row: {
          created_at: string
          id: number
          note: string
          reporter_id: string
          resolved_at: string | null
          slot_id: string
          subject_id: string
          upheld: boolean | null
        }
        Insert: {
          created_at?: string
          id?: number
          note: string
          reporter_id: string
          resolved_at?: string | null
          slot_id: string
          subject_id: string
          upheld?: boolean | null
        }
        Update: {
          created_at?: string
          id?: number
          note?: string
          reporter_id?: string
          resolved_at?: string | null
          slot_id?: string
          subject_id?: string
          upheld?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "no_show_reports_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          email_attempts: number
          email_claimed_at: string | null
          email_error: string | null
          emailed_at: string | null
          id: number
          kind: string
          payload: Json
          read_at: string | null
          slot_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email_attempts?: number
          email_claimed_at?: string | null
          email_error?: string | null
          emailed_at?: string | null
          id?: number
          kind: string
          payload?: Json
          read_at?: string | null
          slot_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email_attempts?: number
          email_claimed_at?: string | null
          email_error?: string | null
          emailed_at?: string | null
          id?: number
          kind?: string
          payload?: Json
          read_at?: string | null
          slot_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          bio: string | null
          city: string | null
          created_at: string
          display_name: string
          geog_approx: unknown
          handle: string
          id: string
          reel_url: string | null
          role: string
          search_radius_mi: number
        }
        Insert: {
          bio?: string | null
          city?: string | null
          created_at?: string
          display_name: string
          geog_approx?: unknown
          handle: string
          id: string
          reel_url?: string | null
          role: string
          search_radius_mi?: number
        }
        Update: {
          bio?: string | null
          city?: string | null
          created_at?: string
          display_name?: string
          geog_approx?: unknown
          handle?: string
          id?: string
          reel_url?: string | null
          role?: string
          search_radius_mi?: number
        }
        Relationships: []
      }
      reviews: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: number
          rating: number
          slot_id: string
          subject_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: number
          rating: number
          slot_id: string
          subject_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: number
          rating?: number
          slot_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_locations: {
        Row: {
          address: string | null
          created_at: string
          geog: unknown
          slot_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          geog: unknown
          slot_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          geog?: unknown
          slot_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_locations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: true
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slots: {
        Row: {
          area_label: string | null
          awarded_bid_id: string | null
          bid_count: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_from: string | null
          claim_cents: number
          closes_at: string
          created_at: string
          current_cents: number | null
          delivers: string[]
          description: string | null
          ends_at: string
          floor_rate_cents: number
          gear: string[]
          geog_approx: unknown
          id: string
          leader_id: string | null
          location: string
          poster_url: string | null
          radius_mi: number
          reel_url: string | null
          settled_at: string | null
          settled_cents: number | null
          shoot_date: string
          starts_at: string
          status: string
          step_cents: number
          title: string
          videographer_id: string
          winner_id: string | null
        }
        Insert: {
          area_label?: string | null
          awarded_bid_id?: string | null
          bid_count?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from?: string | null
          claim_cents: number
          closes_at: string
          created_at?: string
          current_cents?: number | null
          delivers?: string[]
          description?: string | null
          ends_at?: string
          floor_rate_cents: number
          gear?: string[]
          geog_approx?: unknown
          id?: string
          leader_id?: string | null
          location: string
          poster_url?: string | null
          radius_mi?: number
          reel_url?: string | null
          settled_at?: string | null
          settled_cents?: number | null
          shoot_date: string
          starts_at?: string
          status?: string
          step_cents?: number
          title: string
          videographer_id: string
          winner_id?: string | null
        }
        Update: {
          area_label?: string | null
          awarded_bid_id?: string | null
          bid_count?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_from?: string | null
          claim_cents?: number
          closes_at?: string
          created_at?: string
          current_cents?: number | null
          delivers?: string[]
          description?: string | null
          ends_at?: string
          floor_rate_cents?: number
          gear?: string[]
          geog_approx?: unknown
          id?: string
          leader_id?: string | null
          location?: string
          poster_url?: string | null
          radius_mi?: number
          reel_url?: string | null
          settled_at?: string | null
          settled_cents?: number | null
          shoot_date?: string
          starts_at?: string
          status?: string
          step_cents?: number
          title?: string
          videographer_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slots_awarded_bid_id_fkey"
            columns: ["awarded_bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slots_videographer_id_fkey"
            columns: ["videographer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      videographer_stats: {
        Row: {
          bookings_won: number | null
          confirmed_no_shows: number | null
          id: string | null
          late_cancels: number | null
          rating: number | null
          rating_shown: boolean | null
          reliability_shown: boolean | null
          review_count: number | null
          shoots_completed: number | null
          shoots_done: number | null
          withdrawn_auctions: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      cancel_slot: {
        Args: { p_reason?: string; p_slot: string }
        Returns: Json
      }
      claim_slot: { Args: { p_slot: string }; Returns: Json }
      close_due_slots: { Args: never; Returns: number }
      mark_notifications_read: { Args: { p_ids?: number[] }; Returns: number }
      my_search_area: {
        Args: never
        Returns: {
          lat: number
          lng: number
          radius_mi: number
        }[]
      }
      place_bid: {
        Args: { p_max_cents: number; p_slot: string }
        Returns: Json
      }
      report_no_show: {
        Args: { p_note: string; p_slot: string }
        Returns: Json
      }
      set_profile_location: {
        Args: { p_lat: number; p_lng: number }
        Returns: Json
      }
      set_slot_location: {
        Args: {
          p_address?: string
          p_lat: number
          p_lng: number
          p_slot: string
        }
        Returns: Json
      }
      slot_bid_history: {
        Args: { p_slot: string }
        Returns: {
          bid_at: string
          bidder: string
          is_you: boolean
        }[]
      }
      slots_near: {
        Args: {
          p_lat: number
          p_limit?: number
          p_lng: number
          p_offset?: number
          p_radius_mi?: number
        }
        Returns: {
          area_label: string
          bid_count: number
          claim_cents: number
          closes_at: string
          current_cents: number
          distance_mi: number
          floor_rate_cents: number
          id: string
          location: string
          poster_url: string
          reel_url: string
          shoot_date: string
          title: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  TableName extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]),
> = (DefaultSchema["Tables"] & DefaultSchema["Views"])[TableName] extends {
  Row: infer R
}
  ? R
  : never

export type TablesInsert<TableName extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][TableName] extends { Insert: infer I } ? I : never

export type TablesUpdate<TableName extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][TableName] extends { Update: infer U } ? U : never

/** One row of slots_near() — the feed card shape, plus how far away it is. */
export type NearbySlot =
  Database["public"]["Functions"]["slots_near"]["Returns"][number]
