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
      offers: {
        Row: {
          area_label: string | null
          conversation_id: string | null
          created_at: string
          decided_at: string | null
          ends_at: string
          expires_at: string
          from_id: string
          id: string
          location: string
          note: string | null
          price_cents: number
          reel_id: string | null
          shoot_date: string
          slot_id: string | null
          starts_at: string
          status: string
          title: string
          to_id: string
        }
        Insert: {
          area_label?: string | null
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          ends_at?: string
          expires_at: string
          from_id: string
          id?: string
          location: string
          note?: string | null
          price_cents: number
          reel_id?: string | null
          shoot_date: string
          slot_id?: string | null
          starts_at?: string
          status?: string
          title: string
          to_id: string
        }
        Update: {
          area_label?: string | null
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          ends_at?: string
          expires_at?: string
          from_id?: string
          id?: string
          location?: string
          note?: string | null
          price_cents?: number
          reel_id?: string | null
          shoot_date?: string
          slot_id?: string | null
          starts_at?: string
          status?: string
          title?: string
          to_id?: string
        }
        Relationships: []
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          slot_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          slot_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          slot_id?: string | null
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: number
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: number
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: number
          sender_id?: string
        }
        Relationships: []
      }
      reels: {
        Row: {
          aspect: string
          caption: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          owner_id: string
          poster_url: string | null
          video_url: string
        }
        Insert: {
          aspect?: string
          caption?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          owner_id: string
          poster_url?: string | null
          video_url: string
        }
        Update: {
          aspect?: string
          caption?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          owner_id?: string
          poster_url?: string | null
          video_url?: string
        }
        Relationships: []
      }
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
          avatar_url: string | null
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
          avatar_url?: string | null
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
          avatar_url?: string | null
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
          delivered_at: string | null
          delivered_reel_id: string | null
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
          reel_id: string | null
          reel_url: string | null
          settled_at: string | null
          settled_cents: number | null
          shoot_date: string
          source: string
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
          delivered_at?: string | null
          delivered_reel_id?: string | null
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
          reel_id?: string | null
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
          delivered_at?: string | null
          delivered_reel_id?: string | null
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
          reel_id?: string | null
          reel_url?: string | null
          settled_at?: string | null
          settled_cents?: number | null
          shoot_date?: string
          source?: string
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
      follow_counts: {
        Row: {
          followers: number | null
          following: number | null
          id: string | null
        }
        Insert: {
          followers?: never
          following?: never
          id?: string | null
        }
        Update: {
          followers?: never
          following?: never
          id?: string | null
        }
        Relationships: []
      }
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
      deliver_reel: {
        Args: { p_reel: string; p_slot: string }
        Returns: Json
      }
      my_offers: {
        Args: { p_box?: string }
        Returns: {
          area_label: string
          conversation_id: string
          created_at: string
          decided_at: string
          ends_at: string
          expires_at: string
          id: string
          location: string
          note: string
          other_avatar_url: string
          other_handle: string
          other_id: string
          other_name: string
          price_cents: number
          reel_id: string
          reel_poster_url: string
          shoot_date: string
          slot_id: string
          starts_at: string
          status: string
          title: string
        }[]
      }
      respond_to_offer: {
        Args: { p_accept: boolean; p_offer: string }
        Returns: Json
      }
      send_offer: {
        Args: {
          p_area_label?: string
          p_ends_at?: string
          p_expires_at: string
          p_location: string
          p_note?: string
          p_price_cents: number
          p_reel?: string
          p_shoot_date: string
          p_starts_at?: string
          p_title: string
          p_to: string
        }
        Returns: string
      }
      withdraw_offer: { Args: { p_offer: string }; Returns: undefined }
      is_conversation_participant: {
        Args: { p_conv: string }
        Returns: boolean
      }
      is_following: { Args: { p_user: string }; Returns: boolean }
      mark_conversation_read: { Args: { p_conv: string }; Returns: undefined }
      my_badges: {
        Args: never
        Returns: {
          bell_unread: number
          primary_unread: number
          request_unread: number
        }[]
      }
      my_inbox: {
        Args: { p_folder?: string }
        Returns: {
          conversation_id: string
          is_primary: boolean
          last_message_at: string
          other_avatar_url: string
          other_handle: string
          other_id: string
          other_name: string
          preview: string
          unread: number
        }[]
      }
      my_reels: {
        Args: never
        Returns: {
          aspect: string
          caption: string
          created_at: string
          duration_seconds: number
          id: string
          poster_url: string
          video_url: string
        }[]
      }
      profile_grid: {
        Args: { p_handle: string; p_limit?: number; p_offset?: number }
        Returns: {
          aspect: string
          caption: string
          created_at: string
          credit_handle: string
          credit_name: string
          duration_seconds: number
          id: string
          live_cents: number
          live_closes_at: string
          live_slot_id: string
          poster_url: string
          source: string
          video_url: string
        }[]
      }
      reels_following: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          aspect: string
          caption: string
          created_at: string
          duration_seconds: number
          id: string
          live_cents: number
          live_closes_at: string
          live_slot_id: string
          owner_avatar_url: string
          owner_handle: string
          owner_id: string
          owner_name: string
          poster_url: string
          video_url: string
        }[]
      }
      slots_board: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          area_label: string
          aspect: string
          avatar_url: string
          bid_count: number
          claim_cents: number
          closes_at: string
          current_cents: number
          distance_mi: number
          duration_seconds: number
          floor_rate_cents: number
          handle: string
          id: string
          location: string
          poster_url: string
          rating: number
          shoot_date: string
          title: string
          video_url: string
          videographer_id: string
          videographer_name: string
        }[]
      }
      slots_following: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          area_label: string
          aspect: string
          avatar_url: string
          bid_count: number
          claim_cents: number
          closes_at: string
          current_cents: number
          floor_rate_cents: number
          handle: string
          id: string
          location: string
          poster_url: string
          reel_url: string
          shoot_date: string
          title: string
          videographer_id: string
          videographer_name: string
        }[]
      }
      start_conversation: {
        Args: { p_slot?: string; p_user: string }
        Returns: string
      }
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
          aspect: string
          avatar_url: string
          bid_count: number
          claim_cents: number
          closes_at: string
          current_cents: number
          distance_mi: number
          duration_seconds: number
          floor_rate_cents: number
          handle: string
          id: string
          location: string
          poster_url: string
          rating: number
          shoot_date: string
          title: string
          video_url: string
          videographer_id: string
          videographer_name: string
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
