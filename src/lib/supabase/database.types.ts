export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          billing_interval: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          plan: string
          stripe_customer_id: string | null
          stripe_event_created_at: string | null
          stripe_subscription_id: string | null
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id: string
          plan?: string
          stripe_customer_id?: string | null
          stripe_event_created_at?: string | null
          stripe_subscription_id?: string | null
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          stripe_customer_id?: string | null
          stripe_event_created_at?: string | null
          stripe_subscription_id?: string | null
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      admin_audit: {
        Row: {
          account_id: string | null
          action: string
          admin_id: string
          created_at: string
          detail: Json
          id: number
          report_id: string | null
        }
        Insert: {
          account_id?: string | null
          action: string
          admin_id: string
          created_at?: string
          detail?: Json
          id?: never
          report_id?: string | null
        }
        Update: {
          account_id?: string | null
          action?: string
          admin_id?: string
          created_at?: string
          detail?: Json
          id?: never
          report_id?: string | null
        }
        Relationships: []
      }
      blocked_domains: {
        Row: {
          added_by: string | null
          created_at: string
          domain: string
          reason: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          domain: string
          reason?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          domain?: string
          reason?: string | null
        }
        Relationships: []
      }
      daily_dim_stats: {
        Row: {
          clicks: number
          day: string
          dim: string
          page_id: string
          value: string
          views: number
        }
        Insert: {
          clicks?: number
          day: string
          dim: string
          page_id: string
          value: string
          views?: number
        }
        Update: {
          clicks?: number
          day?: string
          dim?: string
          page_id?: string
          value?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_dim_stats_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_stats: {
        Row: {
          block_id: string
          clicks: number
          day: string
          page_id: string
          uniques: number
          views: number
        }
        Insert: {
          block_id?: string
          clicks?: number
          day: string
          page_id: string
          uniques?: number
          views?: number
        }
        Update: {
          block_id?: string
          clicks?: number
          day?: string
          page_id?: string
          uniques?: number
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_stats_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          created_at: string
          hostname: string
          id: string
          last_checked_at: string | null
          live_email_sent_at: string | null
          page_id: string
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          hostname: string
          id?: string
          last_checked_at?: string | null
          live_email_sent_at?: string | null
          page_id: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          hostname?: string
          id?: string
          last_checked_at?: string | null
          live_email_sent_at?: string | null
          page_id?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "domains_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          block_id: string
          country: string | null
          device: string | null
          id: number
          page_id: string
          referrer: string | null
          ts: string
          type: string
          visitor_hash: string
        }
        Insert: {
          block_id?: string
          country?: string | null
          device?: string | null
          id?: never
          page_id: string
          referrer?: string | null
          ts?: string
          type: string
          visitor_hash: string
        }
        Update: {
          block_id?: string
          country?: string | null
          device?: string | null
          id?: never
          page_id?: string
          referrer?: string | null
          ts?: string
          type?: string
          visitor_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      image_cleanup_queue: {
        Row: {
          owner_id: string
          path: string
          queued_at: string
        }
        Insert: {
          owner_id: string
          path: string
          queued_at?: string
        }
        Update: {
          owner_id?: string
          path?: string
          queued_at?: string
        }
        Relationships: []
      }
      image_upload_hits: {
        Row: {
          hit_at: string
          id: number
          owner_id: string
        }
        Insert: {
          hit_at?: string
          id?: never
          owner_id: string
        }
        Update: {
          hit_at?: string
          id?: never
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_upload_hits_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      page_versions: {
        Row: {
          created_at: string
          document: Json
          id: string
          page_id: string
          published_at: string
          version_no: number
        }
        Insert: {
          created_at?: string
          document: Json
          id?: string
          page_id: string
          published_at: string
          version_no: number
        }
        Update: {
          created_at?: string
          document?: Json
          id?: string
          page_id?: string
          published_at?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          created_at: string
          draft: Json
          handle: string
          id: string
          name: string
          owner_id: string
          published: Json | null
          published_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft: Json
          handle: string
          id?: string
          name?: string
          owner_id: string
          published?: Json | null
          published_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft?: Json
          handle?: string
          id?: string
          name?: string
          owner_id?: string
          published?: Json | null
          published_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      preview_links: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          page_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          page_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          page_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "preview_links_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_hits: {
        Row: {
          bucket: string
          hit_at: string
          id: number
        }
        Insert: {
          bucket: string
          hit_at?: string
          id?: never
        }
        Update: {
          bucket?: string
          hit_at?: string
          id?: never
        }
        Relationships: []
      }
      report_attempts: {
        Row: {
          bucket: string
          created_at: string
          id: number
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: never
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          owner_id: string | null
          page_handle: string | null
          page_id: string | null
          reason: string
          reporter_email: string | null
          reporter_hash: string | null
          resolved_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          owner_id?: string | null
          page_handle?: string | null
          page_id?: string | null
          reason: string
          reporter_email?: string | null
          reporter_hash?: string | null
          resolved_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          owner_id?: string | null
          page_handle?: string | null
          page_id?: string | null
          reason?: string
          reporter_email?: string | null
          reporter_hash?: string | null
          resolved_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_handles: {
        Row: {
          handle: string
        }
        Insert: {
          handle: string
        }
        Update: {
          handle?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          id: string
          received_at: string
          stripe_created_at: string
          type: string
        }
        Insert: {
          id: string
          received_at?: string
          stripe_created_at: string
          type: string
        }
        Update: {
          id?: string
          received_at?: string
          stripe_created_at?: string
          type?: string
        }
        Relationships: []
      }
      themes: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string | null
          tokens: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string | null
          tokens: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string | null
          tokens?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "themes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_flags: {
        Row: {
          flagged_at: string
          id: string
          page_id: string
          reviewed_at: string | null
          views: number
          views_previous_month: number | null
          window_end: string
          window_start: string
        }
        Insert: {
          flagged_at?: string
          id?: string
          page_id: string
          reviewed_at?: string | null
          views: number
          views_previous_month?: number | null
          window_end: string
          window_start: string
        }
        Update: {
          flagged_at?: string
          id?: string
          page_id?: string
          reviewed_at?: string | null
          views?: number
          views_previous_month?: number | null
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "traffic_flags_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_upload_bytes: { Args: { p_uid: string }; Returns: number }
      account_usage: {
        Args: { p_uid: string }
        Returns: {
          domains: number
          pages: number
          saved_themes: number
          upload_bytes: number
        }[]
      }
      admin_account_emails: {
        Args: { p_ids: string[] }
        Returns: {
          email: string
          id: string
        }[]
      }
      admin_blocked_domain_impact: {
        Args: { p_domain: string; p_limit?: number }
        Returns: {
          draft_pages: number
          handle: string
          hosts: string[]
          link_count: number
          page_id: string
          total_pages: number
        }[]
      }
      admin_search_pages: {
        Args: { p_limit?: number; p_offset?: number; p_query?: string }
        Returns: {
          handle: string
          owner_email: string
          owner_id: string
          page_count: number
          page_id: string
          plan: string
          published_at: string
          suspended_at: string
          total_count: number
        }[]
      }
      admin_traffic_flags: {
        Args: { p_limit?: number; p_offset?: number; p_reviewed?: boolean }
        Returns: {
          flag_id: string
          flagged_at: string
          handle: string
          owner_email: string
          owner_id: string
          page_id: string
          plan: string
          reviewed_at: string
          total_count: number
          views: number
          views_previous_month: number
          window_end: string
          window_start: string
        }[]
      }
      apply_subscription_state: {
        Args: {
          p_account_id: string
          p_cancel_at_period_end: boolean
          p_event_created: string
          p_interval: string
          p_period_end: string
          p_plan: string
          p_subscription_id: string
        }
        Returns: string
      }
      blocked_links_in: {
        Args: { p_draft: Json }
        Returns: {
          block_id: string
          field: string
          host: string
          item_id: string
          reason: string
        }[]
      }
      blocklist_pct_decode: { Args: { p_text: string }; Returns: string }
      blocklist_url_host: { Args: { p_url: string }; Returns: string }
      claim_domain_check: {
        Args: { p_cooldown_seconds?: number; p_id: string }
        Returns: boolean
      }
      claim_domain_live_email: { Args: { p_id: string }; Returns: boolean }
      flag_high_traffic_pages: { Args: { threshold?: number }; Returns: number }
      mark_domain_verified: { Args: { p_id: string }; Returns: boolean }
      media_image_paths: { Args: { p_doc: Json }; Returns: string[] }
      media_paths_in_use: {
        Args: { p_paths: string[]; p_uid: string }
        Returns: string[]
      }
      media_upload_rate_hit: {
        Args: { p_limit: number; p_uid: string; p_window_seconds: number }
        Returns: {
          allowed: boolean
          retry_after: number
        }[]
      }
      plan_limits: {
        Args: { p_plan: string }
        Returns: {
          analytics_breakdowns: boolean
          analytics_history_days: number
          max_domains: number
          max_pages: number
          max_saved_themes: number
          max_upload_bytes: number
          versions_kept: number
        }[]
      }
      purge_old_events: { Args: never; Returns: number }
      rate_limit_hit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: {
          allowed: boolean
          retry_after: number
        }[]
      }
      report_rate_limit_hit: {
        Args: { p_keys: string[]; p_limit: number; p_window_seconds: number }
        Returns: Json
      }
      rollup_daily_stats: { Args: { p_day: string }; Returns: number }
      rollup_recent_days: { Args: { n: number }; Returns: number }
      run_domain_verification_sweep: { Args: never; Returns: undefined }
      run_nightly_maintenance: { Args: never; Returns: undefined }
      submit_report: {
        Args: {
          p_details: string
          p_email: string
          p_hashes: string[]
          p_page_cap?: number
          p_page_handle: string
          p_page_id: string
          p_reason: string
        }
        Returns: string
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
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

