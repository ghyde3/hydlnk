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
      account_site_bytes: {
        Row: {
          bytes: number
          owner_id: string
        }
        Insert: {
          bytes?: number
          owner_id: string
        }
        Update: {
          bytes?: number
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_site_bytes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          billing_interval: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          gift_plan: string | null
          gift_reason: string | null
          gift_until: string | null
          gifted_at: string | null
          gifted_by: string | null
          id: string
          paid_plan: string
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
          gift_plan?: string | null
          gift_reason?: string | null
          gift_until?: string | null
          gifted_at?: string | null
          gifted_by?: string | null
          id: string
          paid_plan?: string
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
          gift_plan?: string | null
          gift_reason?: string | null
          gift_until?: string | null
          gifted_at?: string | null
          gifted_by?: string | null
          id?: string
          paid_plan?: string
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
      announcements: {
        Row: {
          created_at: string
          created_by: string
          ends_at: string
          id: string
          link: string | null
          message: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ends_at: string
          id?: string
          link?: string | null
          message: string
          starts_at: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_at?: string
          id?: string
          link?: string | null
          message?: string
          starts_at?: string
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
          sub_page_id: string
          value: string
          views: number
        }
        Insert: {
          clicks?: number
          day: string
          dim: string
          page_id: string
          sub_page_id?: string
          value: string
          views?: number
        }
        Update: {
          clicks?: number
          day?: string
          dim?: string
          page_id?: string
          sub_page_id?: string
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
      daily_site_stats: {
        Row: {
          day: string
          page_id: string
          uniques: number
        }
        Insert: {
          day: string
          page_id: string
          uniques?: number
        }
        Update: {
          day?: string
          page_id?: string
          uniques?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_site_stats_page_id_fkey"
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
          sub_page_id: string
          uniques: number
          views: number
        }
        Insert: {
          block_id?: string
          clicks?: number
          day: string
          page_id: string
          sub_page_id?: string
          uniques?: number
          views?: number
        }
        Update: {
          block_id?: string
          clicks?: number
          day?: string
          page_id?: string
          sub_page_id?: string
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
          sub_page_id: string | null
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
          sub_page_id?: string | null
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
          sub_page_id?: string | null
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
      mcp_activity: {
        Row: {
          at: string
          client_id: string
          error_code: string | null
          grant_id: string | null
          id: number
          ok: boolean
          page_id: string | null
          tool: string
          user_id: string
        }
        Insert: {
          at?: string
          client_id: string
          error_code?: string | null
          grant_id?: string | null
          id?: never
          ok: boolean
          page_id?: string | null
          tool: string
          user_id: string
        }
        Update: {
          at?: string
          client_id?: string
          error_code?: string | null
          grant_id?: string | null
          id?: never
          ok?: boolean
          page_id?: string | null
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_activity_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "oauth_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_activity_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_authorization_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_expires_at: string | null
          code_hash: string | null
          created_at: string
          csrf_hash: string | null
          family_id: string | null
          id: string
          redirect_uri: string
          request_expires_at: string
          resource: string
          scopes_granted: string[] | null
          scopes_requested: string[]
          state: string | null
          status: string
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          csrf_hash?: string | null
          family_id?: string | null
          id?: string
          redirect_uri: string
          request_expires_at?: string
          resource: string
          scopes_granted?: string[] | null
          scopes_requested: string[]
          state?: string | null
          status?: string
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          csrf_hash?: string | null
          family_id?: string | null
          id?: string
          redirect_uri?: string
          request_expires_at?: string
          resource?: string
          scopes_granted?: string[] | null
          scopes_requested?: string[]
          state?: string | null
          status?: string
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_authorization_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "oauth_authorization_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_blocked_hosts: {
        Row: {
          blocked_at: string
          blocked_by: string | null
          client_id: string
          host: string
        }
        Insert: {
          blocked_at?: string
          blocked_by?: string | null
          client_id: string
          host: string
        }
        Update: {
          blocked_at?: string
          blocked_by?: string | null
          client_id?: string
          host?: string
        }
        Relationships: []
      }
      oauth_clients: {
        Row: {
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string
          client_name: string
          created_at: string
          expires_at: string | null
          fetched_at: string | null
          kind: string
          last_seen_at: string
          logo_png: string | null
          redirect_uris: string[]
        }
        Insert: {
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id: string
          client_name: string
          created_at?: string
          expires_at?: string | null
          fetched_at?: string | null
          kind: string
          last_seen_at?: string
          logo_png?: string | null
          redirect_uris: string[]
        }
        Update: {
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string
          client_name?: string
          created_at?: string
          expires_at?: string | null
          fetched_at?: string | null
          kind?: string
          last_seen_at?: string
          logo_png?: string | null
          redirect_uris?: string[]
        }
        Relationships: []
      }
      oauth_grants: {
        Row: {
          authorized_at: string
          client_id: string
          created_at: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          authorized_at?: string
          client_id: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          authorized_at?: string
          client_id?: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_grants_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "oauth_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_tokens: {
        Row: {
          created_at: string
          expires_at: string
          family_id: string
          grant_id: string
          id: string
          kind: string
          last_used_at: string | null
          resource: string | null
          revoked_at: string | null
          rotated_at: string | null
          scopes: string[]
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          family_id?: string
          grant_id: string
          id?: string
          kind: string
          last_used_at?: string | null
          resource?: string | null
          revoked_at?: string | null
          rotated_at?: string | null
          scopes: string[]
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          family_id?: string
          grant_id?: string
          id?: string
          kind?: string
          last_used_at?: string | null
          resource?: string | null
          revoked_at?: string | null
          rotated_at?: string | null
          scopes?: string[]
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_tokens_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "oauth_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_tokens_user_id_fkey"
            columns: ["user_id"]
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
          sub_pages: Json
          version_no: number
        }
        Insert: {
          created_at?: string
          document: Json
          id?: string
          page_id: string
          published_at: string
          sub_pages?: Json
          version_no: number
        }
        Update: {
          created_at?: string
          document?: Json
          id?: string
          page_id?: string
          published_at?: string
          sub_pages?: Json
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
          added_by: string | null
          created_at: string
          handle: string
          kind: string
          reason: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          handle: string
          kind?: string
          reason?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          handle?: string
          kind?: string
          reason?: string | null
        }
        Relationships: []
      }
      site_pages: {
        Row: {
          created_at: string
          draft: Json
          id: string
          live_path: string | null
          page_id: string
          published: Json | null
          published_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft: Json
          id?: string
          live_path?: string | null
          page_id: string
          published?: Json | null
          published_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft?: Json
          id?: string
          live_path?: string | null
          page_id?: string
          published?: Json | null
          published_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_pages_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
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
      admin_account_detail: {
        Args: { p_id: string }
        Returns: {
          active_apps: number
          domains: number
          email: string
          gift_plan: string
          gift_reason: string
          gift_until: string
          gifted_at: string
          gifted_by: string
          id: string
          last_sign_in_at: string
          live_sites: number
          paid_plan: string
          plan: string
          reports_open: number
          reports_total: number
          signed_up_at: string
          site_bytes: number
          sites: number
          stripe_customer_id: string
          sub_pages: number
          suspended_at: string
          upload_bytes: number
          verified_domains: number
        }[]
      }
      admin_account_emails: {
        Args: { p_ids: string[] }
        Returns: {
          email: string
          id: string
        }[]
      }
      admin_add_reserved_handle: {
        Args: { p_admin: string; p_handle: string; p_reason: string }
        Returns: {
          handle: string
          holder_email: string
          holder_owner_id: string
          holder_page_id: string
          outcome: string
        }[]
      }
      admin_block_oauth_client: {
        Args: {
          p_admin: string
          p_client_id: string
          p_hosts?: string[]
          p_reason: string
        }
        Returns: {
          grants_ended: number
          outcome: string
          tokens_ended: number
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
      admin_clear_announcement: { Args: never; Returns: number }
      admin_cron_health: {
        Args: never
        Returns: {
          active: boolean
          duration_ms: number
          failed_24h: number
          jobid: number
          jobname: string
          last_end_at: string
          last_message: string
          last_run_at: string
          last_status: string
          runs_24h: number
          schedule: string
        }[]
      }
      admin_domains_needing_help: {
        Args: { p_limit?: number }
        Returns: {
          age_seconds: number
          created_at: string
          domain_id: string
          handle: string
          hostname: string
          last_checked_at: string
          owner_email: string
          owner_id: string
          page_id: string
          reason: string
          status: string
        }[]
      }
      admin_end_gift: { Args: { p_account: string }; Returns: string }
      admin_list_reserved_handles: {
        Args: {
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_query?: string
        }
        Returns: {
          added_by: string
          created_at: string
          handle: string
          holder_owner_id: string
          holder_page_id: string
          kind: string
          reason: string
          total_count: number
        }[]
      }
      admin_oauth_apps: {
        Args: { p_limit?: number }
        Returns: {
          active_connections: number
          blocked_at: string
          blocked_by: string
          blocked_reason: string
          calls_7d: number
          client_id: string
          client_name: string
          created_at: string
          errors_7d: number
          kind: string
          last_call_at: string
        }[]
      }
      admin_overview_numbers: {
        Args: never
        Returns: {
          accounts_free: number
          accounts_pro: number
          accounts_studio: number
          accounts_total: number
          gifted_active: number
          live_custom_domains: number
          live_sites: number
          live_sub_pages: number
          paying_pro: number
          paying_studio: number
          paying_total: number
          sub_pages: number
          views_7d: number
        }[]
      }
      admin_remove_reserved_handle: {
        Args: { p_handle: string }
        Returns: string
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
      admin_set_announcement: {
        Args: {
          p_admin: string
          p_ends: string
          p_link: string
          p_message: string
          p_starts: string
        }
        Returns: string
      }
      admin_set_gift: {
        Args: {
          p_account: string
          p_admin: string
          p_plan: string
          p_reason: string
          p_until: string
        }
        Returns: string
      }
      admin_signups_per_day: {
        Args: { p_days?: number }
        Returns: {
          day: string
          signups: number
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
      admin_unblock_oauth_client: {
        Args: { p_client_id: string }
        Returns: string
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
      end_expired_gifts: {
        Args: never
        Returns: {
          account_id: string
        }[]
      }
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
      oauth_bind_request: {
        Args: { p_csrf_hash: string; p_id: string; p_user: string }
        Returns: {
          client_id: string
          code_challenge: string
          code_expires_at: string | null
          code_hash: string | null
          created_at: string
          csrf_hash: string | null
          family_id: string | null
          id: string
          redirect_uri: string
          request_expires_at: string
          resource: string
          scopes_granted: string[] | null
          scopes_requested: string[]
          state: string | null
          status: string
          used_at: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "oauth_authorization_codes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      oauth_decide_request: {
        Args: {
          p_code_hash: string
          p_csrf_hash: string
          p_decision: string
          p_id: string
          p_scopes: string[]
          p_user: string
        }
        Returns: {
          client_id: string
          code_challenge: string
          code_expires_at: string | null
          code_hash: string | null
          created_at: string
          csrf_hash: string | null
          family_id: string | null
          id: string
          redirect_uri: string
          request_expires_at: string
          resource: string
          scopes_granted: string[] | null
          scopes_requested: string[]
          state: string | null
          status: string
          used_at: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "oauth_authorization_codes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      oauth_end_family: { Args: { p_family: string }; Returns: undefined }
      oauth_end_grant: { Args: { p_grant: string }; Returns: undefined }
      oauth_host_blocked: { Args: { p_hosts: string[] }; Returns: boolean }
      oauth_redeem_code: {
        Args: {
          p_access_hash: string
          p_code_hash: string
          p_refresh_hash: string
        }
        Returns: {
          access_expires_at: string
          client_id: string
          grant_id: string
          outcome: string
          refresh_expires_at: string
          resource: string
          scopes: string[]
          user_id: string
        }[]
      }
      oauth_revoke_all_user_grants: {
        Args: { p_user: string }
        Returns: number
      }
      oauth_revoke_by_token: {
        Args: { p_client_id: string; p_token_hash: string }
        Returns: boolean
      }
      oauth_revoke_user_grant: {
        Args: { p_grant: string; p_user: string }
        Returns: string
      }
      oauth_rotate_refresh: {
        Args: {
          p_access_hash: string
          p_old_id: string
          p_refresh_hash: string
          p_scopes: string[]
        }
        Returns: {
          access_expires_at: string
          grant_id: string
          outcome: string
          refresh_expires_at: string
          resource: string
          scopes: string[]
          user_id: string
        }[]
      }
      oauth_touch_token: { Args: { p_token: string }; Returns: boolean }
      oauth_trim_unused_cimd: {
        Args: { p_cap: number; p_keep: string[] }
        Returns: number
      }
      oauth_trim_unused_dcr: { Args: { p_cap: number }; Returns: number }
      oauth_uris_ok: { Args: { p_uris: string[] }; Returns: boolean }
      oauth_verify_access_token: {
        Args: { p_resource: string; p_token_hash: string }
        Returns: {
          client_id: string
          expires_at: string
          grant_id: string
          last_used_at: string
          scopes: string[]
          token_id: string
          user_id: string
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
          pages_per_site: number
          redirect_mode: boolean
          versions_kept: number
        }[]
      }
      publish_site: {
        Args: {
          p_home: Json
          p_owner_id: string
          p_page_id: string
          p_published_at?: string
          p_sub_pages: Json
        }
        Returns: string
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
      requeue_media: {
        Args: { p_owner: string; p_paths: string[] }
        Returns: number
      }
      rollup_daily_stats: { Args: { p_day: string }; Returns: number }
      rollup_recent_days: { Args: { n: number }; Returns: number }
      run_domain_verification_sweep: { Args: never; Returns: undefined }
      run_gift_expiry_sweep: { Args: never; Returns: undefined }
      run_nightly_maintenance: { Args: never; Returns: undefined }
      site_click_pairs: {
        Args: { p_page_id: string }
        Returns: {
          block_id: string
          sub_page_id: string
        }[]
      }
      site_page_doc_bytes: {
        Args: { p_draft: Json; p_published: Json }
        Returns: number
      }
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

