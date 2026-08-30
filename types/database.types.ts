// Generated via `supabase gen types typescript --local` against the local
// schema built from supabase/migrations/. Do not hand-edit — regenerate
// after every schema migration.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          changed_at: string
          changed_by: string | null
          id: string
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      club_aliases: {
        Row: {
          alias: string
          created_at: string
          created_by: string | null
          directory_id: string
          id: string
          normalized_key: string
          source: string | null
        }
        Insert: {
          alias: string
          created_at?: string
          created_by?: string | null
          directory_id: string
          id?: string
          normalized_key: string
          source?: string | null
        }
        Update: {
          alias?: string
          created_at?: string
          created_by?: string | null
          directory_id?: string
          id?: string
          normalized_key?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_aliases_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      club_claims: {
        Row: {
          authority_declaration: string
          claimant_user_id: string
          claimed_role: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          directory_id: string
          id: string
          status: string
          updated_at: string
          verification_method: string | null
        }
        Insert: {
          authority_declaration: string
          claimant_user_id: string
          claimed_role: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          directory_id: string
          id?: string
          status?: string
          updated_at?: string
          verification_method?: string | null
        }
        Update: {
          authority_declaration?: string
          claimant_user_id?: string
          claimed_role?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          directory_id?: string
          id?: string
          status?: string
          updated_at?: string
          verification_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_claims_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      club_contacts: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_public: boolean
          name: string
          phone: string | null
          role: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_public?: boolean
          name: string
          phone?: string | null
          role: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_public?: boolean
          name?: string
          phone?: string | null
          role?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_directory: {
        Row: {
          active: boolean
          address: string | null
          constituent_body: string | null
          country: string
          county: string | null
          created_at: string
          created_by: string | null
          external_id: string | null
          home_ground: string | null
          id: string
          name: string
          nation: string
          normalized_key: string
          notes: string | null
          official_email: string | null
          postcode: string | null
          region: string | null
          rugby_code: string
          source: string
          source_updated_at: string | null
          source_url: string
          town: string | null
          updated_at: string
          updated_by: string | null
          verification_status: string
          website: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          constituent_body?: string | null
          country: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          home_ground?: string | null
          id?: string
          name: string
          nation: string
          normalized_key: string
          notes?: string | null
          official_email?: string | null
          postcode?: string | null
          region?: string | null
          rugby_code: string
          source: string
          source_updated_at?: string | null
          source_url: string
          town?: string | null
          updated_at?: string
          updated_by?: string | null
          verification_status: string
          website?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          constituent_body?: string | null
          country?: string
          county?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          home_ground?: string | null
          id?: string
          name?: string
          nation?: string
          normalized_key?: string
          notes?: string | null
          official_email?: string | null
          postcode?: string | null
          region?: string | null
          rugby_code?: string
          source?: string
          source_updated_at?: string | null
          source_url?: string
          town?: string | null
          updated_at?: string
          updated_by?: string | null
          verification_status?: string
          website?: string | null
        }
        Relationships: []
      }
      club_join_requests: {
        Row: {
          club_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_role: string
          requesting_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_role: string
          requesting_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_role?: string
          requesting_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_memberships: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          id: string
          role: string
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          role?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          role?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_opponent_notes: {
        Row: {
          created_at: string
          created_by: string | null
          directory_id: string
          distance_miles: number | null
          distance_minutes: number | null
          id: string
          legacy_ref: string | null
          notes: string | null
          owning_club_id: string
          priority_level: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          directory_id: string
          distance_miles?: number | null
          distance_minutes?: number | null
          id?: string
          legacy_ref?: string | null
          notes?: string | null
          owning_club_id: string
          priority_level?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          directory_id?: string
          distance_miles?: number | null
          distance_minutes?: number | null
          id?: string
          legacy_ref?: string | null
          notes?: string | null
          owning_club_id?: string
          priority_level?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_opponent_notes_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_opponent_notes_owning_club_id_fkey"
            columns: ["owning_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          address_display: string | null
          bio: string | null
          created_at: string
          created_by: string | null
          directory_id: string
          established_year: number | null
          facebook_url: string | null
          id: string
          latitude: number | null
          legacy_logo_path: string | null
          logo_storage_path: string | null
          longitude: number | null
          slug: string
          status: string
          updated_at: string
          updated_by: string | null
          website: string | null
        }
        Insert: {
          address_display?: string | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          directory_id: string
          established_year?: number | null
          facebook_url?: string | null
          id?: string
          latitude?: number | null
          legacy_logo_path?: string | null
          logo_storage_path?: string | null
          longitude?: number | null
          slug: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          address_display?: string | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          directory_id?: string
          established_year?: number | null
          facebook_url?: string | null
          id?: string
          latitude?: number | null
          legacy_logo_path?: string | null
          logo_storage_path?: string | null
          longitude?: number | null
          slug?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clubs_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: true
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_edition_teams: {
        Row: {
          competition_edition_id: string
          created_at: string
          created_by: string | null
          id: string
          team_id: string
        }
        Insert: {
          competition_edition_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          team_id: string
        }
        Update: {
          competition_edition_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_edition_teams_competition_edition_id_fkey"
            columns: ["competition_edition_id"]
            isOneToOne: false
            referencedRelation: "competition_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_edition_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_editions: {
        Row: {
          active: boolean
          competition_id: string
          created_at: string
          created_by: string | null
          id: string
          rugby_code: string
          season_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          competition_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          rugby_code: string
          season_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          competition_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          rugby_code?: string
          season_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_editions_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_editions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          level: string | null
          name: string
          normalized_key: string
          rugby_code: string
          slug: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          level?: string | null
          name: string
          normalized_key: string
          rugby_code: string
          slug: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          level?: string | null
          name?: string
          normalized_key?: string
          rugby_code?: string
          slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      directory_requests: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          address_line_3: string | null
          bio: string | null
          club_name: string
          country: string | null
          county: string | null
          created_at: string
          created_directory_id: string | null
          email: string | null
          id: string
          logo_upload_ref: string | null
          phone: string | null
          postcode: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string | null
          town: string | null
          updated_at: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          bio?: string | null
          club_name: string
          country?: string | null
          county?: string | null
          created_at?: string
          created_directory_id?: string | null
          email?: string | null
          id?: string
          logo_upload_ref?: string | null
          phone?: string | null
          postcode?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string | null
          town?: string | null
          updated_at?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          bio?: string | null
          club_name?: string
          country?: string | null
          county?: string | null
          created_at?: string
          created_directory_id?: string | null
          email?: string | null
          id?: string
          logo_upload_ref?: string | null
          phone?: string | null
          postcode?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string | null
          town?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_requests_created_directory_id_fkey"
            columns: ["created_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_source_refs: {
        Row: {
          created_at: string
          fixture_id: string
          id: string
          source_id: string
          source_system: string
        }
        Insert: {
          created_at?: string
          fixture_id: string
          id?: string
          source_id: string
          source_system: string
        }
        Update: {
          created_at?: string
          fixture_id?: string
          id?: string
          source_id?: string
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_source_refs_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_score: number | null
          changing_room: string | null
          competition_edition_id: string | null
          created_at: string
          created_by: string | null
          event_type: string | null
          final_confirmation: boolean
          home_away: string
          home_score: number | null
          id: string
          kickoff_date: string
          kickoff_time: string | null
          legacy_fixture_ref: string | null
          notes: string | null
          opponent_directory_id: string | null
          opponent_team_id: string | null
          owning_team_id: string
          pitch_allocation: string | null
          raw_opposition_text: string
          season_label: string | null
          stage_one_confirmation: boolean
          status: string
          updated_at: string
          updated_by: string | null
          venue_address: string | null
          venue_id: string | null
        }
        Insert: {
          away_score?: number | null
          changing_room?: string | null
          competition_edition_id?: string | null
          created_at?: string
          created_by?: string | null
          event_type?: string | null
          final_confirmation?: boolean
          home_away: string
          home_score?: number | null
          id?: string
          kickoff_date: string
          kickoff_time?: string | null
          legacy_fixture_ref?: string | null
          notes?: string | null
          opponent_directory_id?: string | null
          opponent_team_id?: string | null
          owning_team_id: string
          pitch_allocation?: string | null
          raw_opposition_text: string
          season_label?: string | null
          stage_one_confirmation?: boolean
          status?: string
          updated_at?: string
          updated_by?: string | null
          venue_address?: string | null
          venue_id?: string | null
        }
        Update: {
          away_score?: number | null
          changing_room?: string | null
          competition_edition_id?: string | null
          created_at?: string
          created_by?: string | null
          event_type?: string | null
          final_confirmation?: boolean
          home_away?: string
          home_score?: number | null
          id?: string
          kickoff_date?: string
          kickoff_time?: string | null
          legacy_fixture_ref?: string | null
          notes?: string | null
          opponent_directory_id?: string | null
          opponent_team_id?: string | null
          owning_team_id?: string
          pitch_allocation?: string | null
          raw_opposition_text?: string
          season_label?: string | null
          stage_one_confirmation?: boolean
          status?: string
          updated_at?: string
          updated_by?: string | null
          venue_address?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixtures_competition_edition_id_fkey"
            columns: ["competition_edition_id"]
            isOneToOne: false
            referencedRelation: "competition_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          address_line_3: string | null
          country: string | null
          county: string | null
          created_at: string
          date_of_birth: string | null
          first_name: string
          id: string
          postcode: string | null
          surname: string
          town: string | null
          updated_at: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name: string
          id: string
          postcode?: string | null
          surname: string
          town?: string | null
          updated_at?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          first_name?: string
          id?: string
          postcode?: string | null
          surname?: string
          town?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      seasons: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          name: string
          starts_on: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ends_on: string
          id?: string
          name: string
          starts_on: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          ends_on?: string
          id?: string
          name?: string
          starts_on?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      site_admins: {
        Row: {
          created_at: string
          granted_at: string
          granted_by: string | null
          id: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      team_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_public: boolean
          name: string
          phone: string | null
          role: string
          team_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_public?: boolean
          name: string
          phone?: string | null
          role: string
          team_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_public?: boolean
          name?: string
          phone?: string | null
          role?: string
          team_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_contacts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          permission: string
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          permission?: string
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          permission?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_permissions_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "club_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_permissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          active: boolean
          age_group: string | null
          category: string
          club_id: string
          created_at: string
          created_by: string | null
          display_name: string
          gender: string | null
          id: string
          identity_key: string | null
          legacy_team_ref: string | null
          rugby_code: string
          slug: string
          squad_designation: string | null
          team_number: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          age_group?: string | null
          category: string
          club_id: string
          created_at?: string
          created_by?: string | null
          display_name: string
          gender?: string | null
          id?: string
          identity_key?: string | null
          legacy_team_ref?: string | null
          rugby_code: string
          slug: string
          squad_designation?: string | null
          team_number?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          age_group?: string | null
          category?: string
          club_id?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          gender?: string | null
          id?: string
          identity_key?: string | null
          legacy_team_ref?: string | null
          rugby_code?: string
          slug?: string
          squad_designation?: string | null
          team_number?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_acceptances: {
        Row: {
          accepted_at: string
          id: string
          terms_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          terms_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: []
      }
      unresolved_names: {
        Row: {
          created_at: string
          entity_type: string
          id: string
          normalized_key: string
          raw_value: string
          resolved_at: string | null
          resolved_by: string | null
          resolved_directory_id: string | null
          source: string | null
          status: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          id?: string
          normalized_key: string
          raw_value: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_directory_id?: string | null
          source?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          id?: string
          normalized_key?: string
          raw_value?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_directory_id?: string | null
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "unresolved_names_resolved_directory_id_fkey"
            columns: ["resolved_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          active: boolean
          address: string | null
          club_id: string | null
          created_at: string
          created_by: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          slug: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          slug: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_team: { Args: { p_team_id: string }; Returns: boolean }
      is_club_admin: { Args: { p_club_id: string }; Returns: boolean }
      is_site_admin: { Args: never; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
