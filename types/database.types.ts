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
      age_grade_rollover_group_flags: {
        Row: {
          created_at: string
          id: string
          reason: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          rollover_id: string
          scheduling_group_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          rollover_id: string
          scheduling_group_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          rollover_id?: string
          scheduling_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "age_grade_rollover_group_flags_rollover_id_fkey"
            columns: ["rollover_id"]
            isOneToOne: false
            referencedRelation: "age_grade_rollovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "age_grade_rollover_group_flags_scheduling_group_id_fkey"
            columns: ["scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      age_grade_rollover_team_proposals: {
        Row: {
          created_at: string
          current_age_group: string
          decided_age_group: string | null
          decided_at: string | null
          decided_by: string | null
          decision: string
          girls_team_created: boolean | null
          girls_team_id: string | null
          id: string
          is_mixed_boundary: boolean
          proposed_age_group: string | null
          requires_manual_choice: boolean
          rollover_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          current_age_group: string
          decided_age_group?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          girls_team_created?: boolean | null
          girls_team_id?: string | null
          id?: string
          is_mixed_boundary?: boolean
          proposed_age_group?: string | null
          requires_manual_choice?: boolean
          rollover_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          current_age_group?: string
          decided_age_group?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          girls_team_created?: boolean | null
          girls_team_id?: string | null
          id?: string
          is_mixed_boundary?: boolean
          proposed_age_group?: string | null
          requires_manual_choice?: boolean
          rollover_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "age_grade_rollover_team_proposals_girls_team_id_fkey"
            columns: ["girls_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_girls_team_id_fkey"
            columns: ["girls_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_girls_team_id_fkey"
            columns: ["girls_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_girls_team_id_fkey"
            columns: ["girls_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_girls_team_id_fkey"
            columns: ["girls_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_rollover_id_fkey"
            columns: ["rollover_id"]
            isOneToOne: false
            referencedRelation: "age_grade_rollovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "age_grade_rollover_team_proposals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      age_grade_rollovers: {
        Row: {
          club_id: string
          created_at: string
          created_by: string | null
          from_season_id: string | null
          id: string
          rugby_code: string
          to_season_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by?: string | null
          from_season_id?: string | null
          id?: string
          rugby_code: string
          to_season_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string | null
          from_season_id?: string | null
          id?: string
          rugby_code?: string
          to_season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_from_season_id_fkey"
            columns: ["from_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "age_grade_rollovers_to_season_id_fkey"
            columns: ["to_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          changed_at: string
          changed_by: string | null
          id: string
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: string
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      canonical_team_types: {
        Row: {
          age_group: string | null
          allows_squads: boolean
          category: string
          created_at: string
          created_by: string | null
          fixed_squad_designation: string | null
          gender: string | null
          id: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          age_group?: string | null
          allows_squads?: boolean
          category: string
          created_at?: string
          created_by?: string | null
          fixed_squad_designation?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean
          key: string
          label: string
          sort_order: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          age_group?: string | null
          allows_squads?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          fixed_squad_designation?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      capabilities: {
        Row: {
          applicable_scopes: string[]
          category: string
          description: string | null
          key: string
          label: string
        }
        Insert: {
          applicable_scopes?: string[]
          category: string
          description?: string | null
          key: string
          label: string
        }
        Update: {
          applicable_scopes?: string[]
          category?: string
          description?: string | null
          key?: string
          label?: string
        }
        Relationships: []
      }
      capability_overrides: {
        Row: {
          capability_key: string
          club_id: string | null
          created_at: string
          effect: string
          granted_at: string
          granted_by: string
          id: string
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope_type: string
          status: string
          team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capability_key: string
          club_id?: string | null
          created_at?: string
          effect: string
          granted_at?: string
          granted_by: string
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_type: string
          status?: string
          team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          capability_key?: string
          club_id?: string | null
          created_at?: string
          effect?: string
          granted_at?: string
          granted_by?: string
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope_type?: string
          status?: string
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capability_overrides_capability_key_fkey"
            columns: ["capability_key"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "capability_overrides_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capability_overrides_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "capability_overrides_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "capability_overrides_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "capability_overrides_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "capability_overrides_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "club_aliases_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
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
          proposed_teams: Json
          review_notes: string | null
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
          proposed_teams?: Json
          review_notes?: string | null
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
          proposed_teams?: Json
          review_notes?: string | null
          status?: string
          updated_at?: string
          verification_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_claims_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "club_claims_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
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
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_contacts_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_conversations: {
        Row: {
          created_at: string
          id: string
          recipient_club_id: string
          requested_by: string
          requesting_club_id: string
          responded_at: string | null
          responded_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_club_id: string
          requested_by: string
          requesting_club_id: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_club_id?: string
          requested_by?: string
          requesting_club_id?: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_conversations_recipient_club_id_fkey"
            columns: ["recipient_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_conversations_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
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
          geocode_source: string | null
          geocode_status: string
          geocoded_at: string | null
          home_ground: string | null
          id: string
          latitude: number | null
          logo_storage_path: string | null
          longitude: number | null
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
          source_url: string | null
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
          geocode_source?: string | null
          geocode_status?: string
          geocoded_at?: string | null
          home_ground?: string | null
          id?: string
          latitude?: number | null
          logo_storage_path?: string | null
          longitude?: number | null
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
          source_url?: string | null
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
          geocode_source?: string | null
          geocode_status?: string
          geocoded_at?: string | null
          home_ground?: string | null
          id?: string
          latitude?: number | null
          logo_storage_path?: string | null
          longitude?: number | null
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
          source_url?: string | null
          town?: string | null
          updated_at?: string
          updated_by?: string | null
          verification_status?: string
          website?: string | null
        }
        Relationships: []
      }
      club_directory_research_proposals: {
        Row: {
          confidence: string
          conflict_reason: string | null
          created_at: string
          current_value: string | null
          directory_id: string
          field: string
          id: string
          proposed_value: string
          researched_at: string
          researched_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          source_url: string | null
          status: string
        }
        Insert: {
          confidence: string
          conflict_reason?: string | null
          created_at?: string
          current_value?: string | null
          directory_id: string
          field: string
          id?: string
          proposed_value: string
          researched_at?: string
          researched_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          source_url?: string | null
          status?: string
        }
        Update: {
          confidence?: string
          conflict_reason?: string | null
          created_at?: string
          current_value?: string | null
          directory_id?: string
          field?: string
          id?: string
          proposed_value?: string
          researched_at?: string
          researched_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_url?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_directory_research_proposals_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "club_directory_research_proposals_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "club_directory_research_proposals_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      club_directory_rugby_code_corrections: {
        Row: {
          corrected_at: string
          corrected_by: string
          directory_id: string
          from_code: string
          id: string
          reason: string
          to_code: string
        }
        Insert: {
          corrected_at?: string
          corrected_by: string
          directory_id: string
          from_code: string
          id?: string
          reason: string
          to_code: string
        }
        Update: {
          corrected_at?: string
          corrected_by?: string
          directory_id?: string
          from_code?: string
          id?: string
          reason?: string
          to_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_directory_rugby_code_corrections_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "club_directory_rugby_code_corrections_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "club_directory_rugby_code_corrections_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      club_documents: {
        Row: {
          archived_at: string | null
          category: string
          checksum: string | null
          club_id: string | null
          created_at: string
          description: string | null
          directory_id: string | null
          folder_id: string | null
          id: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          title: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          archived_at?: string | null
          category?: string
          checksum?: string | null
          club_id?: string | null
          created_at?: string
          description?: string | null
          directory_id?: string | null
          folder_id?: string | null
          id?: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          title: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          archived_at?: string | null
          category?: string
          checksum?: string | null
          club_id?: string | null
          created_at?: string
          description?: string | null
          directory_id?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          storage_path?: string
          title?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_documents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_documents_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "club_documents_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "club_documents_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "document_folders"
            referencedColumns: ["id"]
          },
        ]
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
          review_notes: string | null
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
          review_notes?: string | null
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
          review_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
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
          assigned_group_id: string | null
          authority_restored_at: string | null
          authority_restored_by: string | null
          authority_suspended: boolean
          authority_suspended_at: string | null
          club_id: string
          club_role_title: string | null
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
          assigned_group_id?: string | null
          authority_restored_at?: string | null
          authority_restored_by?: string | null
          authority_suspended?: boolean
          authority_suspended_at?: string | null
          club_id: string
          club_role_title?: string | null
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
          assigned_group_id?: string | null
          authority_restored_at?: string | null
          authority_restored_by?: string | null
          authority_suspended?: boolean
          authority_suspended_at?: string | null
          club_id?: string
          club_role_title?: string | null
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
            foreignKeyName: "club_memberships_assigned_group_id_fkey"
            columns: ["assigned_group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
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
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "club_opponent_notes_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
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
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_opponent_notes_owning_club_id_fkey"
            columns: ["owning_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_opponent_notes_owning_club_id_fkey"
            columns: ["owning_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_opponent_notes_owning_club_id_fkey"
            columns: ["owning_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_opponent_notes_owning_club_id_fkey"
            columns: ["owning_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_opponent_notes_owning_club_id_fkey"
            columns: ["owning_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_opponent_notes_owning_club_id_fkey"
            columns: ["owning_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
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
      club_ovalball_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          club_directory_id: string
          contact_email: string
          contact_name: string
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          inviting_club_id: string
          resulting_partnership_id: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_directory_id: string
          contact_email: string
          contact_name: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by: string
          inviting_club_id: string
          resulting_partnership_id?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_directory_id?: string
          contact_email?: string
          contact_name?: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          inviting_club_id?: string
          resulting_partnership_id?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_ovalball_invitations_club_directory_id_fkey"
            columns: ["club_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_club_directory_id_fkey"
            columns: ["club_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_club_directory_id_fkey"
            columns: ["club_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_inviting_club_id_fkey"
            columns: ["inviting_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_ovalball_invitations_resulting_partnership_id_fkey"
            columns: ["resulting_partnership_id"]
            isOneToOne: false
            referencedRelation: "club_partnerships"
            referencedColumns: ["id"]
          },
        ]
      }
      club_partnerships: {
        Row: {
          created_at: string
          id: string
          partner_club_id: string
          requested_at: string
          requested_by: string
          requesting_club_id: string
          responded_at: string | null
          responded_by: string | null
          revoked_at: string | null
          revoked_by: string | null
          source_fixture_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          partner_club_id: string
          requested_at?: string
          requested_by: string
          requesting_club_id: string
          responded_at?: string | null
          responded_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source_fixture_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          partner_club_id?: string
          requested_at?: string
          requested_by?: string
          requesting_club_id?: string
          responded_at?: string | null
          responded_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source_fixture_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_partner_club_id_fkey"
            columns: ["partner_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_partnerships_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_partnerships_source_fixture_id_fkey"
            columns: ["source_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_partnerships_source_fixture_id_fkey"
            columns: ["source_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      club_pitches: {
        Row: {
          active: boolean
          club_id: string
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          id: string
          lane_count: number
          size_category: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          venue_id: string | null
        }
        Insert: {
          active?: boolean
          club_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          id?: string
          lane_count?: number
          size_category?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          venue_id?: string | null
        }
        Update: {
          active?: boolean
          club_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          id?: string
          lane_count?: number
          size_category?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_pitches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_pitches_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      club_scheduling_policy: {
        Row: {
          auto_allocate_home_fixtures: boolean
          club_id: string
          pack_up_minutes: number
          turnaround_minutes: number
          updated_at: string
          updated_by: string | null
          warm_up_minutes: number
          weekday_earliest_kickoff: string
          weekend_senior_earliest: string
          weekend_senior_latest: string
          weekend_youth_earliest: string
          weekend_youth_latest: string
        }
        Insert: {
          auto_allocate_home_fixtures?: boolean
          club_id: string
          pack_up_minutes?: number
          turnaround_minutes?: number
          updated_at?: string
          updated_by?: string | null
          warm_up_minutes?: number
          weekday_earliest_kickoff?: string
          weekend_senior_earliest?: string
          weekend_senior_latest?: string
          weekend_youth_earliest?: string
          weekend_youth_latest?: string
        }
        Update: {
          auto_allocate_home_fixtures?: boolean
          club_id?: string
          pack_up_minutes?: number
          turnaround_minutes?: number
          updated_at?: string
          updated_by?: string | null
          warm_up_minutes?: number
          weekday_earliest_kickoff?: string
          weekend_senior_earliest?: string
          weekend_senior_latest?: string
          weekend_youth_earliest?: string
          weekend_youth_latest?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "club_scheduling_policy_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
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
          deactivated_at: string | null
          deactivated_by: string | null
          deactivation_reason: string | null
          directory_id: string
          established_year: number | null
          facebook_url: string | null
          id: string
          latitude: number | null
          legacy_logo_path: string | null
          logo_storage_path: string | null
          longitude: number | null
          reactivated_at: string | null
          reactivated_by: string | null
          show_address: boolean
          show_home_ground: boolean
          show_postcode: boolean
          show_website: boolean
          slug: string
          status: string
          timezone: string
          updated_at: string
          updated_by: string | null
          website: string | null
        }
        Insert: {
          address_display?: string | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          directory_id: string
          established_year?: number | null
          facebook_url?: string | null
          id?: string
          latitude?: number | null
          legacy_logo_path?: string | null
          logo_storage_path?: string | null
          longitude?: number | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          show_address?: boolean
          show_home_ground?: boolean
          show_postcode?: boolean
          show_website?: boolean
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          address_display?: string | null
          bio?: string | null
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivation_reason?: string | null
          directory_id?: string
          established_year?: number | null
          facebook_url?: string | null
          id?: string
          latitude?: number | null
          legacy_logo_path?: string | null
          logo_storage_path?: string | null
          longitude?: number | null
          reactivated_at?: string | null
          reactivated_by?: string | null
          show_address?: boolean
          show_home_ground?: boolean
          show_postcode?: boolean
          show_website?: boolean
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clubs_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: true
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "clubs_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: true
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "clubs_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: true
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_areas: {
        Row: {
          area_id: string
          competition_id: string
        }
        Insert: {
          area_id: string
          competition_id: string
        }
        Update: {
          area_id?: string
          competition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_areas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "geographic_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_areas_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
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
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "competition_edition_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "competition_edition_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "competition_edition_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
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
          description: string | null
          id: string
          is_national: boolean
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
          description?: string | null
          id?: string
          is_national?: boolean
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
          description?: string | null
          id?: string
          is_national?: boolean
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
          proposed_teams: Json
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rugby_code: string | null
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
          proposed_teams?: Json
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rugby_code?: string | null
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
          proposed_teams?: Json
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rugby_code?: string | null
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
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "directory_requests_created_directory_id_fkey"
            columns: ["created_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "directory_requests_created_directory_id_fkey"
            columns: ["created_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_verification_run_records: {
        Row: {
          detail: string | null
          directory_id: string
          id: string
          outcome: string
          processed_at: string
          run_id: string
        }
        Insert: {
          detail?: string | null
          directory_id: string
          id?: string
          outcome: string
          processed_at?: string
          run_id: string
        }
        Update: {
          detail?: string | null
          directory_id?: string
          id?: string
          outcome?: string
          processed_at?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "directory_verification_run_records_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "directory_verification_run_records_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "directory_verification_run_records_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "directory_verification_run_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "directory_verification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      directory_verification_runs: {
        Row: {
          completed_at: string | null
          conflicts_found: number
          failed_count: number
          id: string
          last_error: string | null
          no_result_count: number
          processed_records: number
          proposals_created: number
          scope: string
          scope_filter: Json | null
          started_at: string
          started_by: string
          status: string
          total_records: number
        }
        Insert: {
          completed_at?: string | null
          conflicts_found?: number
          failed_count?: number
          id?: string
          last_error?: string | null
          no_result_count?: number
          processed_records?: number
          proposals_created?: number
          scope: string
          scope_filter?: Json | null
          started_at?: string
          started_by: string
          status?: string
          total_records: number
        }
        Update: {
          completed_at?: string | null
          conflicts_found?: number
          failed_count?: number
          id?: string
          last_error?: string | null
          no_result_count?: number
          processed_records?: number
          proposals_created?: number
          scope?: string
          scope_filter?: Json | null
          started_at?: string
          started_by?: string
          status?: string
          total_records?: number
        }
        Relationships: []
      }
      document_folders: {
        Row: {
          archived_at: string | null
          club_id: string | null
          created_at: string
          created_by: string | null
          directory_id: string | null
          id: string
          name: string
          parent_folder_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          directory_id?: string | null
          id?: string
          name: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          directory_id?: string | null
          id?: string
          name?: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "document_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_folders_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "document_folders_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "document_folders_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "document_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_conversation_participants: {
        Row: {
          added_at: string
          added_by: string
          fixture_id: string | null
          fixture_request_id: string | null
          id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          fixture_id?: string | null
          fixture_request_id?: string | null
          id?: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          fixture_id?: string | null
          fixture_request_id?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_conversation_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "admin_user_overview"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "fixture_conversation_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_conversation_participants_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_conversation_participants_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_conversation_participants_fixture_request_id_fkey"
            columns: ["fixture_request_id"]
            isOneToOne: false
            referencedRelation: "fixture_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_overview"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "fixture_conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_conversation_subscriptions: {
        Row: {
          fixture_id: string | null
          fixture_request_id: string | null
          id: string
          left_at: string | null
          muted: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          fixture_id?: string | null
          fixture_request_id?: string | null
          id?: string
          left_at?: string | null
          muted?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          fixture_id?: string | null
          fixture_request_id?: string | null
          id?: string
          left_at?: string | null
          muted?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_conversation_subscriptions_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_conversation_subscriptions_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_conversation_subscriptions_fixture_request_id_fkey"
            columns: ["fixture_request_id"]
            isOneToOne: false
            referencedRelation: "fixture_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_conversation_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_overview"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "fixture_conversation_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_import_batches: {
        Row: {
          club_id: string | null
          created_at: string
          filename: string
          id: string
          published_at: string | null
          published_by: string | null
          row_count: number
          state: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          filename: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          row_count?: number
          state?: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          filename?: string
          id?: string
          published_at?: string | null
          published_by?: string | null
          row_count?: number
          state?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "fixture_import_batches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_import_rows: {
        Row: {
          batch_id: string
          conflict_decision: string | null
          conflicting_fixture_id: string | null
          created_at: string
          errors: Json
          fixture_date: string | null
          id: string
          kickoff_time: string | null
          matched_fixture_id: string | null
          normalized_game_type: string | null
          notes: string | null
          published_fixture_id: string | null
          raw: Json
          raw_opposition_text: string | null
          resolved_away_directory_id: string | null
          resolved_away_score: number | null
          resolved_away_team_id: string | null
          resolved_competition_edition_id: string | null
          resolved_home_score: number | null
          resolved_home_team_id: string | null
          resolved_pitch_id: string | null
          resolved_status: string | null
          resolved_venue_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          row_number: number
          source_reference: string | null
          status: string
        }
        Insert: {
          batch_id: string
          conflict_decision?: string | null
          conflicting_fixture_id?: string | null
          created_at?: string
          errors?: Json
          fixture_date?: string | null
          id?: string
          kickoff_time?: string | null
          matched_fixture_id?: string | null
          normalized_game_type?: string | null
          notes?: string | null
          published_fixture_id?: string | null
          raw: Json
          raw_opposition_text?: string | null
          resolved_away_directory_id?: string | null
          resolved_away_score?: number | null
          resolved_away_team_id?: string | null
          resolved_competition_edition_id?: string | null
          resolved_home_score?: number | null
          resolved_home_team_id?: string | null
          resolved_pitch_id?: string | null
          resolved_status?: string | null
          resolved_venue_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_number: number
          source_reference?: string | null
          status?: string
        }
        Update: {
          batch_id?: string
          conflict_decision?: string | null
          conflicting_fixture_id?: string | null
          created_at?: string
          errors?: Json
          fixture_date?: string | null
          id?: string
          kickoff_time?: string | null
          matched_fixture_id?: string | null
          normalized_game_type?: string | null
          notes?: string | null
          published_fixture_id?: string | null
          raw?: Json
          raw_opposition_text?: string | null
          resolved_away_directory_id?: string | null
          resolved_away_score?: number | null
          resolved_away_team_id?: string | null
          resolved_competition_edition_id?: string | null
          resolved_home_score?: number | null
          resolved_home_team_id?: string | null
          resolved_pitch_id?: string | null
          resolved_status?: string | null
          resolved_venue_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_number?: number
          source_reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fixture_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_conflicting_fixture_id_fkey"
            columns: ["conflicting_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_conflicting_fixture_id_fkey"
            columns: ["conflicting_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_matched_fixture_id_fkey"
            columns: ["matched_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_matched_fixture_id_fkey"
            columns: ["matched_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_published_fixture_id_fkey"
            columns: ["published_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_published_fixture_id_fkey"
            columns: ["published_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_directory_id_fkey"
            columns: ["resolved_away_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_directory_id_fkey"
            columns: ["resolved_away_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_directory_id_fkey"
            columns: ["resolved_away_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_team_id_fkey"
            columns: ["resolved_away_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_team_id_fkey"
            columns: ["resolved_away_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_team_id_fkey"
            columns: ["resolved_away_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_team_id_fkey"
            columns: ["resolved_away_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_away_team_id_fkey"
            columns: ["resolved_away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_competition_edition_id_fkey"
            columns: ["resolved_competition_edition_id"]
            isOneToOne: false
            referencedRelation: "competition_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_home_team_id_fkey"
            columns: ["resolved_home_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_home_team_id_fkey"
            columns: ["resolved_home_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_home_team_id_fkey"
            columns: ["resolved_home_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_home_team_id_fkey"
            columns: ["resolved_home_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_home_team_id_fkey"
            columns: ["resolved_home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_pitch_id_fkey"
            columns: ["resolved_pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_import_rows_resolved_venue_id_fkey"
            columns: ["resolved_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_message_attachments: {
        Row: {
          created_at: string
          id: string
          message_id: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          mime_type: string
          original_filename: string
          size_bytes: number
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          mime_type?: string
          original_filename?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "fixture_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_message_contact_cards: {
        Row: {
          club_name_snapshot: string
          display_name_snapshot: string
          id: string
          message_id: string
          role_snapshot: string
          shared_at: string
          shared_by_user_id: string
          team_name_snapshot: string | null
          telephone_snapshot: string
        }
        Insert: {
          club_name_snapshot: string
          display_name_snapshot: string
          id?: string
          message_id: string
          role_snapshot: string
          shared_at?: string
          shared_by_user_id: string
          team_name_snapshot?: string | null
          telephone_snapshot: string
        }
        Update: {
          club_name_snapshot?: string
          display_name_snapshot?: string
          id?: string
          message_id?: string
          role_snapshot?: string
          shared_at?: string
          shared_by_user_id?: string
          team_name_snapshot?: string | null
          telephone_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_message_contact_cards_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "fixture_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_message_contact_cards_shared_by_user_id_fkey"
            columns: ["shared_by_user_id"]
            isOneToOne: false
            referencedRelation: "admin_user_overview"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "fixture_message_contact_cards_shared_by_user_id_fkey"
            columns: ["shared_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_message_document_refs: {
        Row: {
          document_id: string
          id: string
          message_id: string
          shared_at: string
          shared_by: string
        }
        Insert: {
          document_id: string
          id?: string
          message_id: string
          shared_at?: string
          shared_by: string
        }
        Update: {
          document_id?: string
          id?: string
          message_id?: string
          shared_at?: string
          shared_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_message_document_refs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "club_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_message_document_refs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "fixture_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_messages: {
        Row: {
          body: string
          club_conversation_id: string | null
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_by_role: string | null
          fixture_id: string | null
          fixture_request_id: string | null
          id: string
          is_site_admin_message: boolean
          kind: string
          report_reason: string | null
          report_status: string | null
          reported_at: string | null
          reported_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sender_user_id: string
          team_conversation_id: string | null
        }
        Insert: {
          body: string
          club_conversation_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_by_role?: string | null
          fixture_id?: string | null
          fixture_request_id?: string | null
          id?: string
          is_site_admin_message?: boolean
          kind?: string
          report_reason?: string | null
          report_status?: string | null
          reported_at?: string | null
          reported_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_user_id: string
          team_conversation_id?: string | null
        }
        Update: {
          body?: string
          club_conversation_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_by_role?: string | null
          fixture_id?: string | null
          fixture_request_id?: string | null
          id?: string
          is_site_admin_message?: boolean
          kind?: string
          report_reason?: string | null
          report_status?: string | null
          reported_at?: string | null
          reported_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_user_id?: string
          team_conversation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixture_messages_club_conversation_id_fkey"
            columns: ["club_conversation_id"]
            isOneToOne: false
            referencedRelation: "club_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_messages_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_messages_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_messages_fixture_request_id_fkey"
            columns: ["fixture_request_id"]
            isOneToOne: false
            referencedRelation: "fixture_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_messages_team_conversation_id_fkey"
            columns: ["team_conversation_id"]
            isOneToOne: false
            referencedRelation: "team_conversations"
            referencedColumns: ["team_id"]
          },
        ]
      }
      fixture_player_call_up: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          eligibility_requirement_id: string | null
          eligibility_rule_reference: string
          fixture_id: string
          id: string
          player_id: string
          requested_by: string | null
          source_team_id: string
          status: string
          target_team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          eligibility_requirement_id?: string | null
          eligibility_rule_reference: string
          fixture_id: string
          id?: string
          player_id: string
          requested_by?: string | null
          source_team_id: string
          status?: string
          target_team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          eligibility_requirement_id?: string | null
          eligibility_rule_reference?: string
          fixture_id?: string
          id?: string
          player_id?: string
          requested_by?: string | null
          source_team_id?: string
          status?: string
          target_team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_player_call_up_eligibility_requirement_id_fkey"
            columns: ["eligibility_requirement_id"]
            isOneToOne: false
            referencedRelation: "player_team_dispensation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixture_player_call_up_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_request_groups: {
        Row: {
          competition_edition_id: string | null
          created_at: string
          created_by: string
          game_type: string | null
          id: string
          notes: string | null
          opponent_club_id: string | null
          opponent_directory_id: string | null
          proposed_date: string
          raw_opponent_text: string
          requesting_club_id: string
          source: string | null
          updated_at: string
        }
        Insert: {
          competition_edition_id?: string | null
          created_at?: string
          created_by: string
          game_type?: string | null
          id?: string
          notes?: string | null
          opponent_club_id?: string | null
          opponent_directory_id?: string | null
          proposed_date: string
          raw_opponent_text: string
          requesting_club_id: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          competition_edition_id?: string | null
          created_at?: string
          created_by?: string
          game_type?: string | null
          id?: string
          notes?: string | null
          opponent_club_id?: string | null
          opponent_directory_id?: string | null
          proposed_date?: string
          raw_opponent_text?: string
          requesting_club_id?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_request_groups_competition_edition_id_fkey"
            columns: ["competition_edition_id"]
            isOneToOne: false
            referencedRelation: "competition_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_club_id_fkey"
            columns: ["opponent_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "fixture_request_groups_requesting_club_id_fkey"
            columns: ["requesting_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_requests: {
        Row: {
          created_at: string
          created_by: string
          decided_at: string | null
          decided_by: string | null
          group_id: string
          id: string
          note: string | null
          pitch_id: string | null
          preferred_kickoff_time: string | null
          requesting_scheduling_group_id: string | null
          requesting_team_id: string
          resulting_fixture_id: string | null
          status: string
          target_scheduling_group_id: string | null
          target_team_age_group: string | null
          target_team_gender: string | null
          target_team_id: string | null
          target_team_squad_designation: string | null
          updated_at: string
          venue_id: string | null
          venue_preference: string
        }
        Insert: {
          created_at?: string
          created_by: string
          decided_at?: string | null
          decided_by?: string | null
          group_id: string
          id?: string
          note?: string | null
          pitch_id?: string | null
          preferred_kickoff_time?: string | null
          requesting_scheduling_group_id?: string | null
          requesting_team_id: string
          resulting_fixture_id?: string | null
          status?: string
          target_scheduling_group_id?: string | null
          target_team_age_group?: string | null
          target_team_gender?: string | null
          target_team_id?: string | null
          target_team_squad_designation?: string | null
          updated_at?: string
          venue_id?: string | null
          venue_preference: string
        }
        Update: {
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          group_id?: string
          id?: string
          note?: string | null
          pitch_id?: string | null
          preferred_kickoff_time?: string | null
          requesting_scheduling_group_id?: string | null
          requesting_team_id?: string
          resulting_fixture_id?: string | null
          status?: string
          target_scheduling_group_id?: string | null
          target_team_age_group?: string | null
          target_team_gender?: string | null
          target_team_id?: string | null
          target_team_squad_designation?: string | null
          updated_at?: string
          venue_id?: string | null
          venue_preference?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "fixture_request_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_requesting_scheduling_group_id_fkey"
            columns: ["requesting_scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_requesting_team_id_fkey"
            columns: ["requesting_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_requesting_team_id_fkey"
            columns: ["requesting_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_requesting_team_id_fkey"
            columns: ["requesting_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_requesting_team_id_fkey"
            columns: ["requesting_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_requesting_team_id_fkey"
            columns: ["requesting_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_resulting_fixture_id_fkey"
            columns: ["resulting_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_resulting_fixture_id_fkey"
            columns: ["resulting_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_target_scheduling_group_id_fkey"
            columns: ["target_scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixture_requests_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_result_submissions: {
        Row: {
          away_score: number
          created_at: string
          fixture_id: string
          home_score: number
          id: string
          kind: string
          note: string | null
          submitted_by: string
          submitted_by_club_id: string | null
        }
        Insert: {
          away_score: number
          created_at?: string
          fixture_id: string
          home_score: number
          id?: string
          kind: string
          note?: string | null
          submitted_by: string
          submitted_by_club_id?: string | null
        }
        Update: {
          away_score?: number
          created_at?: string
          fixture_id?: string
          home_score?: number
          id?: string
          kind?: string
          note?: string | null
          submitted_by?: string
          submitted_by_club_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixture_result_submissions_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "fixture_result_submissions_submitted_by_club_id_fkey"
            columns: ["submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      fixture_scheduling_rules: {
        Row: {
          age_group: string | null
          confidence: string
          created_at: string
          effective_season: string
          half_minutes: number
          id: string
          min_pitch_size_category: string | null
          rugby_code: string
          source: string
        }
        Insert: {
          age_group?: string | null
          confidence: string
          created_at?: string
          effective_season: string
          half_minutes: number
          id?: string
          min_pitch_size_category?: string | null
          rugby_code: string
          source: string
        }
        Update: {
          age_group?: string | null
          confidence?: string
          created_at?: string
          effective_season?: string
          half_minutes?: number
          id?: string
          min_pitch_size_category?: string | null
          rugby_code?: string
          source?: string
        }
        Relationships: []
      }
      fixture_source_refs: {
        Row: {
          created_at: string
          fixture_id: string
          id: string
          import_batch_id: string | null
          source_id: string
          source_system: string
        }
        Insert: {
          created_at?: string
          fixture_id: string
          id?: string
          import_batch_id?: string | null
          source_id: string
          source_system: string
        }
        Update: {
          created_at?: string
          fixture_id?: string
          id?: string
          import_batch_id?: string | null
          source_id?: string
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixture_source_refs_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_source_refs_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_source_refs_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "fixture_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_score: number | null
          away_team_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_due_to_fold: boolean
          changing_room: string | null
          competition_edition_id: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          event_type: string | null
          game_type: string | null
          home_away: string
          home_score: number | null
          home_team_id: string | null
          id: string
          import_batch_id: string | null
          kickoff_amendment_proposed_at: string | null
          kickoff_amendment_proposed_by: string | null
          kickoff_amendment_proposed_by_club_id: string | null
          kickoff_amendment_proposed_date: string | null
          kickoff_amendment_proposed_time: string | null
          kickoff_date: string
          kickoff_time: string | null
          legacy_fixture_ref: string | null
          mirror_fixture_id: string | null
          notes: string | null
          opponent_directory_id: string | null
          opponent_scheduling_group_id: string | null
          opponent_team_age_group_snapshot: string | null
          opponent_team_display_name_snapshot: string | null
          opponent_team_id: string | null
          owning_scheduling_group_id: string | null
          owning_team_age_group_snapshot: string | null
          owning_team_display_name_snapshot: string | null
          owning_team_id: string
          pitch_allocation: string | null
          pitch_id: string | null
          raw_opposition_text: string
          replaces_fixture_id: string | null
          restoration_requested_at: string | null
          restoration_requested_by: string | null
          result_amendment_proposed_at: string | null
          result_amendment_proposed_away_score: number | null
          result_amendment_proposed_by: string | null
          result_amendment_proposed_by_club_id: string | null
          result_amendment_proposed_home_score: number | null
          result_confirmed_at: string | null
          result_confirmed_by: string | null
          result_deadline_at: string | null
          result_site_admin_resolution_reason: string | null
          result_site_admin_resolved_at: string | null
          result_site_admin_resolved_by: string | null
          result_status: string
          result_submitted_at: string | null
          result_submitted_by: string | null
          result_submitted_by_club_id: string | null
          season_id: string | null
          season_label: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
          venue_address: string | null
          venue_id: string | null
        }
        Insert: {
          away_score?: number | null
          away_team_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_due_to_fold?: boolean
          changing_room?: string | null
          competition_edition_id?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: string | null
          game_type?: string | null
          home_away: string
          home_score?: number | null
          home_team_id?: string | null
          id?: string
          import_batch_id?: string | null
          kickoff_amendment_proposed_at?: string | null
          kickoff_amendment_proposed_by?: string | null
          kickoff_amendment_proposed_by_club_id?: string | null
          kickoff_amendment_proposed_date?: string | null
          kickoff_amendment_proposed_time?: string | null
          kickoff_date: string
          kickoff_time?: string | null
          legacy_fixture_ref?: string | null
          mirror_fixture_id?: string | null
          notes?: string | null
          opponent_directory_id?: string | null
          opponent_scheduling_group_id?: string | null
          opponent_team_age_group_snapshot?: string | null
          opponent_team_display_name_snapshot?: string | null
          opponent_team_id?: string | null
          owning_scheduling_group_id?: string | null
          owning_team_age_group_snapshot?: string | null
          owning_team_display_name_snapshot?: string | null
          owning_team_id: string
          pitch_allocation?: string | null
          pitch_id?: string | null
          raw_opposition_text: string
          replaces_fixture_id?: string | null
          restoration_requested_at?: string | null
          restoration_requested_by?: string | null
          result_amendment_proposed_at?: string | null
          result_amendment_proposed_away_score?: number | null
          result_amendment_proposed_by?: string | null
          result_amendment_proposed_by_club_id?: string | null
          result_amendment_proposed_home_score?: number | null
          result_confirmed_at?: string | null
          result_confirmed_by?: string | null
          result_deadline_at?: string | null
          result_site_admin_resolution_reason?: string | null
          result_site_admin_resolved_at?: string | null
          result_site_admin_resolved_by?: string | null
          result_status?: string
          result_submitted_at?: string | null
          result_submitted_by?: string | null
          result_submitted_by_club_id?: string | null
          season_id?: string | null
          season_label?: string | null
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          venue_address?: string | null
          venue_id?: string | null
        }
        Update: {
          away_score?: number | null
          away_team_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_due_to_fold?: boolean
          changing_room?: string | null
          competition_edition_id?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: string | null
          game_type?: string | null
          home_away?: string
          home_score?: number | null
          home_team_id?: string | null
          id?: string
          import_batch_id?: string | null
          kickoff_amendment_proposed_at?: string | null
          kickoff_amendment_proposed_by?: string | null
          kickoff_amendment_proposed_by_club_id?: string | null
          kickoff_amendment_proposed_date?: string | null
          kickoff_amendment_proposed_time?: string | null
          kickoff_date?: string
          kickoff_time?: string | null
          legacy_fixture_ref?: string | null
          mirror_fixture_id?: string | null
          notes?: string | null
          opponent_directory_id?: string | null
          opponent_scheduling_group_id?: string | null
          opponent_team_age_group_snapshot?: string | null
          opponent_team_display_name_snapshot?: string | null
          opponent_team_id?: string | null
          owning_scheduling_group_id?: string | null
          owning_team_age_group_snapshot?: string | null
          owning_team_display_name_snapshot?: string | null
          owning_team_id?: string
          pitch_allocation?: string | null
          pitch_id?: string | null
          raw_opposition_text?: string
          replaces_fixture_id?: string | null
          restoration_requested_at?: string | null
          restoration_requested_by?: string | null
          result_amendment_proposed_at?: string | null
          result_amendment_proposed_away_score?: number | null
          result_amendment_proposed_by?: string | null
          result_amendment_proposed_by_club_id?: string | null
          result_amendment_proposed_home_score?: number | null
          result_confirmed_at?: string | null
          result_confirmed_by?: string | null
          result_deadline_at?: string | null
          result_site_admin_resolution_reason?: string | null
          result_site_admin_resolved_at?: string | null
          result_site_admin_resolved_by?: string | null
          result_status?: string
          result_submitted_at?: string | null
          result_submitted_by?: string | null
          result_submitted_by_club_id?: string | null
          season_id?: string | null
          season_label?: string | null
          source?: string
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
            foreignKeyName: "fixtures_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "fixture_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "fixtures_kickoff_amendment_proposed_by_club_id_fkey"
            columns: ["kickoff_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_mirror_fixture_id_fkey"
            columns: ["mirror_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_mirror_fixture_id_fkey"
            columns: ["mirror_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_scheduling_group_id_fkey"
            columns: ["opponent_scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_owning_scheduling_group_id_fkey"
            columns: ["owning_scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_replaces_fixture_id_fkey"
            columns: ["replaces_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_replaces_fixture_id_fkey"
            columns: ["replaces_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_amendment_proposed_by_club_id_fkey"
            columns: ["result_amendment_proposed_by_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "fixtures_result_submitted_by_club_id_fkey"
            columns: ["result_submitted_by_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
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
      geographic_areas: {
        Row: {
          id: string
          name: string
          nation: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          nation: string
          sort_order: number
        }
        Update: {
          id?: string
          name?: string
          nation?: string
          sort_order?: number
        }
        Relationships: []
      }
      guardian_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          club_id: string
          created_at: string
          expires_at: string
          id: string
          invited_by_user_id: string
          invited_email: string
          replacement_for_player_id: string | null
          status: string
          team_id: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_id: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by_user_id: string
          invited_email: string
          replacement_for_player_id?: string | null
          status?: string
          team_id: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by_user_id?: string
          invited_email?: string
          replacement_for_player_id?: string | null
          status?: string
          team_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "guardian_invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_invitations_replacement_for_player_id_fkey"
            columns: ["replacement_for_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "guardian_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "guardian_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "guardian_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "guardian_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_player_permissions: {
        Row: {
          actor: string
          created_at: string
          granted: boolean
          guardian_user_id: string
          id: string
          permission_key: string
          player_id: string
          source: string
        }
        Insert: {
          actor: string
          created_at?: string
          granted: boolean
          guardian_user_id: string
          id?: string
          permission_key: string
          player_id: string
          source?: string
        }
        Update: {
          actor?: string
          created_at?: string
          granted?: boolean
          guardian_user_id?: string
          id?: string
          permission_key?: string
          player_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_player_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "player_permission_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "guardian_player_permissions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      guardians: {
        Row: {
          created_at: string
          created_by: string | null
          guardian_user_id: string
          id: string
          player_id: string
          relationship_type: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guardian_user_id: string
          id?: string
          player_id: string
          relationship_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guardian_user_id?: string
          id?: string
          player_id?: string
          relationship_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardians_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_teams: {
        Row: {
          invitation_id: string
          team_id: string
          team_permission: string
        }
        Insert: {
          invitation_id: string
          team_id: string
          team_permission: string
        }
        Update: {
          invitation_id?: string
          team_id?: string
          team_permission?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_teams_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "invitation_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "invitation_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "invitation_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "invitation_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          club_id: string
          club_role: string | null
          created_at: string
          created_by: string
          declared_role: string | null
          expires_at: string
          id: string
          invited_email: string
          status: string
          token: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_id: string
          club_role?: string | null
          created_at?: string
          created_by: string
          declared_role?: string | null
          expires_at?: string
          id?: string
          invited_email: string
          status?: string
          token?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_id?: string
          club_role?: string | null
          created_at?: string
          created_by?: string
          declared_role?: string | null
          expires_at?: string
          id?: string
          invited_email?: string
          status?: string
          token?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      message_policies: {
        Row: {
          allow_contact_card_sharing: boolean | null
          allow_contact_card_sharing_club_override_allowed: boolean
          allow_direct_attachments: boolean | null
          allow_direct_attachments_club_override_allowed: boolean
          allow_document_library_sharing: boolean | null
          allow_document_library_sharing_club_override_allowed: boolean
          allow_image_uploads: boolean | null
          allow_image_uploads_club_override_allowed: boolean
          allow_participant_management: boolean | null
          allow_participant_management_club_override_allowed: boolean
          allowed_file_types: string[]
          club_id: string | null
          created_at: string
          id: string
          max_attachment_size_bytes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allow_contact_card_sharing?: boolean | null
          allow_contact_card_sharing_club_override_allowed?: boolean
          allow_direct_attachments?: boolean | null
          allow_direct_attachments_club_override_allowed?: boolean
          allow_document_library_sharing?: boolean | null
          allow_document_library_sharing_club_override_allowed?: boolean
          allow_image_uploads?: boolean | null
          allow_image_uploads_club_override_allowed?: boolean
          allow_participant_management?: boolean | null
          allow_participant_management_club_override_allowed?: boolean
          allowed_file_types?: string[]
          club_id?: string | null
          created_at?: string
          id?: string
          max_attachment_size_bytes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allow_contact_card_sharing?: boolean | null
          allow_contact_card_sharing_club_override_allowed?: boolean
          allow_direct_attachments?: boolean | null
          allow_direct_attachments_club_override_allowed?: boolean
          allow_document_library_sharing?: boolean | null
          allow_document_library_sharing_club_override_allowed?: boolean
          allow_image_uploads?: boolean | null
          allow_image_uploads_club_override_allowed?: boolean
          allow_participant_management?: boolean | null
          allow_participant_management_club_override_allowed?: boolean
          allowed_file_types?: string[]
          club_id?: string | null
          created_at?: string
          id?: string
          max_attachment_size_bytes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "message_policies_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_enabled: boolean
          in_app_enabled: boolean
          push_enabled: boolean
          topic_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          email_enabled?: boolean
          in_app_enabled?: boolean
          push_enabled?: boolean
          topic_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          email_enabled?: boolean
          in_app_enabled?: boolean
          push_enabled?: boolean
          topic_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_topic_key_fkey"
            columns: ["topic_key"]
            isOneToOne: false
            referencedRelation: "notification_topics"
            referencedColumns: ["key"]
          },
        ]
      }
      notification_topics: {
        Row: {
          description: string
          email_ready: boolean
          key: string
          label: string
          mandatory: boolean
          push_ready: boolean
          sort_order: number
        }
        Insert: {
          description: string
          email_ready?: boolean
          key: string
          label: string
          mandatory?: boolean
          push_ready?: boolean
          sort_order: number
        }
        Update: {
          description?: string
          email_ready?: boolean
          key?: string
          label?: string
          mandatory?: boolean
          push_ready?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      notification_types: {
        Row: {
          topic_key: string
          type_key: string
        }
        Insert: {
          topic_key: string
          type_key: string
        }
        Update: {
          topic_key?: string
          type_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_types_topic_key_fkey"
            columns: ["topic_key"]
            isOneToOne: false
            referencedRelation: "notification_topics"
            referencedColumns: ["key"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      permission_group_capabilities: {
        Row: {
          capability_key: string
          group_id: string
        }
        Insert: {
          capability_key: string
          group_id: string
        }
        Update: {
          capability_key?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_group_capabilities_capability_key_fkey"
            columns: ["capability_key"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "permission_group_capabilities_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          maps_to_role: string | null
          maps_to_team_permission: string | null
          name: string
          scope_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          maps_to_role?: string | null
          maps_to_team_permission?: string | null
          name: string
          scope_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          maps_to_role?: string | null
          maps_to_team_permission?: string | null
          name?: string
          scope_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      pitch_allocation_proposal_items: {
        Row: {
          conflict_reason: string | null
          conflict_severity: string | null
          fixture_id: string
          id: string
          is_unallocated: boolean
          proposal_id: string
          proposed_kickoff_time: string | null
          proposed_pitch_id: string | null
        }
        Insert: {
          conflict_reason?: string | null
          conflict_severity?: string | null
          fixture_id: string
          id?: string
          is_unallocated?: boolean
          proposal_id: string
          proposed_kickoff_time?: string | null
          proposed_pitch_id?: string | null
        }
        Update: {
          conflict_reason?: string | null
          conflict_severity?: string | null
          fixture_id?: string
          id?: string
          is_unallocated?: boolean
          proposal_id?: string
          proposed_kickoff_time?: string | null
          proposed_pitch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pitch_allocation_proposal_items_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposal_items_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposal_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "pitch_allocation_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposal_items_proposed_pitch_id_fkey"
            columns: ["proposed_pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
        ]
      }
      pitch_allocation_proposals: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          club_id: string
          created_at: string
          created_by: string | null
          id: string
          proposal_date: string
          status: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          proposal_date: string
          status?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          proposal_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "pitch_allocation_proposals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      player_account_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string
          player_id: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invited_by: string
          invited_email: string
          player_id: string
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_email?: string
          player_id?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_account_invitations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_duplicate_reviews: {
        Row: {
          created_at: string
          guardian_invitation_id: string | null
          id: string
          matched_player_id: string
          requesting_guardian_user_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          submitted_by: string
          submitted_date_of_birth: string | null
          submitted_first_name: string
          submitted_surname: string
          team_id: string
        }
        Insert: {
          created_at?: string
          guardian_invitation_id?: string | null
          id?: string
          matched_player_id: string
          requesting_guardian_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          submitted_by: string
          submitted_date_of_birth?: string | null
          submitted_first_name: string
          submitted_surname: string
          team_id: string
        }
        Update: {
          created_at?: string
          guardian_invitation_id?: string | null
          id?: string
          matched_player_id?: string
          requesting_guardian_user_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          submitted_by?: string
          submitted_date_of_birth?: string | null
          submitted_first_name?: string
          submitted_surname?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_duplicate_reviews_guardian_invitation_id_fkey"
            columns: ["guardian_invitation_id"]
            isOneToOne: false
            referencedRelation: "guardian_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_duplicate_reviews_matched_player_id_fkey"
            columns: ["matched_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_duplicate_reviews_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "player_duplicate_reviews_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "player_duplicate_reviews_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "player_duplicate_reviews_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "player_duplicate_reviews_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_fixture_attendance: {
        Row: {
          created_at: string
          fixture_id: string
          id: string
          player_id: string
          responded_by_user_id: string
          response_source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fixture_id: string
          id?: string
          player_id: string
          responded_by_user_id: string
          response_source: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fixture_id?: string
          id?: string
          player_id?: string
          responded_by_user_id?: string
          response_source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_fixture_attendance_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_fixture_attendance_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_fixture_attendance_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_graduation_queue: {
        Row: {
          club_id: string
          created_at: string
          id: string
          placed_at: string | null
          placed_by: string | null
          placed_team_id: string | null
          player_id: string
          source_team_id: string
          status: string
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          placed_at?: string | null
          placed_by?: string | null
          placed_team_id?: string | null
          player_id: string
          source_team_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          placed_at?: string | null
          placed_by?: string | null
          placed_team_id?: string | null
          player_id?: string
          source_team_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_graduation_queue_placed_team_id_fkey"
            columns: ["placed_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_placed_team_id_fkey"
            columns: ["placed_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_placed_team_id_fkey"
            columns: ["placed_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_placed_team_id_fkey"
            columns: ["placed_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_placed_team_id_fkey"
            columns: ["placed_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_graduation_queue_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_graduation_queue_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "player_graduation_queue_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_permission_types: {
        Row: {
          description: string
          key: string
          label: string
          max_age: number | null
          min_age: number | null
          sort_order: number
        }
        Insert: {
          description: string
          key: string
          label: string
          max_age?: number | null
          min_age?: number | null
          sort_order: number
        }
        Update: {
          description?: string
          key?: string
          label?: string
          max_age?: number | null
          min_age?: number | null
          sort_order?: number
        }
        Relationships: []
      }
      player_team_dispensation: {
        Row: {
          club_decided_at: string | null
          club_decided_by: string | null
          created_at: string
          decision_reason: string | null
          eligibility_rule_reference: string
          governing_body_decided_at: string | null
          governing_body_decided_by: string | null
          governing_body_reference: string | null
          id: string
          player_id: string
          requested_by: string | null
          season_id: string
          source_team_decided_at: string | null
          source_team_decided_by: string | null
          source_team_id: string
          status: string
          target_team_id: string
          updated_at: string
        }
        Insert: {
          club_decided_at?: string | null
          club_decided_by?: string | null
          created_at?: string
          decision_reason?: string | null
          eligibility_rule_reference: string
          governing_body_decided_at?: string | null
          governing_body_decided_by?: string | null
          governing_body_reference?: string | null
          id?: string
          player_id: string
          requested_by?: string | null
          season_id: string
          source_team_decided_at?: string | null
          source_team_decided_by?: string | null
          source_team_id: string
          status?: string
          target_team_id: string
          updated_at?: string
        }
        Update: {
          club_decided_at?: string | null
          club_decided_by?: string | null
          created_at?: string
          decision_reason?: string | null
          eligibility_rule_reference?: string
          governing_body_decided_at?: string | null
          governing_body_decided_by?: string | null
          governing_body_reference?: string | null
          id?: string
          player_id?: string
          requested_by?: string | null
          season_id?: string
          source_team_decided_at?: string | null
          source_team_decided_by?: string | null
          source_team_id?: string
          status?: string
          target_team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_team_dispensation_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_team_dispensation_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_team_dispensation_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_source_team_id_fkey"
            columns: ["source_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_team_dispensation_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "player_team_dispensation_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_team_memberships: {
        Row: {
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          joined_at: string
          player_id: string
          status: string
          team_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          joined_at?: string
          player_id: string
          status?: string
          team_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          joined_at?: string
          player_id?: string
          status?: string
          team_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_team_memberships_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "player_team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "player_team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "player_team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "player_team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          first_name: string
          id: string
          surname: string
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          first_name: string
          id?: string
          surname: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          first_name?: string
          id?: string
          surname?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: string
          address_line_1: string | null
          address_line_2: string | null
          address_line_3: string | null
          avatar_storage_path: string | null
          country: string | null
          county: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          first_name: string
          id: string
          last_active_at: string | null
          phone_number: string | null
          postcode: string | null
          surname: string
          town: string | null
          updated_at: string
        }
        Insert: {
          account_status?: string
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          avatar_storage_path?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name: string
          id: string
          last_active_at?: string | null
          phone_number?: string | null
          postcode?: string | null
          surname: string
          town?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: string
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          avatar_storage_path?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_active_at?: string | null
          phone_number?: string | null
          postcode?: string | null
          surname?: string
          town?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scheduling_group_members: {
        Row: {
          group_id: string
          team_id: string
        }
        Insert: {
          group_id: string
          team_id: string
        }
        Update: {
          group_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_group_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "scheduling_group_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "scheduling_group_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "scheduling_group_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "scheduling_group_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_groups: {
        Row: {
          active: boolean
          alias: string | null
          club_id: string
          created_at: string
          created_by: string | null
          display_tag: string
          id: string
          season_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          alias?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          display_tag: string
          id?: string
          season_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          alias?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          display_tag?: string
          id?: string
          season_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "scheduling_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_groups_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_transitions: {
        Row: {
          applied_at: string | null
          club_id: string
          created_at: string
          from_season_id: string | null
          id: string
          last_error: string | null
          needs_attention_reason: string | null
          rollover_id: string | null
          rugby_code: string
          status: string
          to_season_id: string
          updated_at: string
          warning_sent_at: string | null
        }
        Insert: {
          applied_at?: string | null
          club_id: string
          created_at?: string
          from_season_id?: string | null
          id?: string
          last_error?: string | null
          needs_attention_reason?: string | null
          rollover_id?: string | null
          rugby_code: string
          status?: string
          to_season_id: string
          updated_at?: string
          warning_sent_at?: string | null
        }
        Update: {
          applied_at?: string | null
          club_id?: string
          created_at?: string
          from_season_id?: string | null
          id?: string
          last_error?: string | null
          needs_attention_reason?: string | null
          rollover_id?: string | null
          rugby_code?: string
          status?: string
          to_season_id?: string
          updated_at?: string
          warning_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "season_transitions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_transitions_from_season_id_fkey"
            columns: ["from_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_transitions_rollover_id_fkey"
            columns: ["rollover_id"]
            isOneToOne: false
            referencedRelation: "age_grade_rollovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_transitions_to_season_id_fkey"
            columns: ["to_season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          is_regression_fixture: boolean
          name: string
          pre_season_starts_on: string | null
          rugby_code: string
          season_ref: string
          season_year_end: number | null
          season_year_start: number
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
          is_regression_fixture?: boolean
          name: string
          pre_season_starts_on?: string | null
          rugby_code: string
          season_ref: string
          season_year_end?: number | null
          season_year_start: number
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
          is_regression_fixture?: boolean
          name?: string
          pre_season_starts_on?: string | null
          rugby_code?: string
          season_ref?: string
          season_year_end?: number | null
          season_year_start?: number
          starts_on?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      site_admin_diagnostic_sessions: {
        Row: {
          club_id: string
          entered_at: string
          exited_at: string | null
          id: string
          site_admin_user_id: string
        }
        Insert: {
          club_id: string
          entered_at?: string
          exited_at?: string | null
          id?: string
          site_admin_user_id: string
        }
        Update: {
          club_id?: string
          entered_at?: string
          exited_at?: string | null
          id?: string
          site_admin_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "site_admin_diagnostic_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      site_admin_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          admin_role: string
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string
          revoked_at: string | null
          revoked_by: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          admin_role: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by: string
          invited_email: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          admin_role?: string
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_email?: string
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_admins: {
        Row: {
          admin_role: string
          created_at: string
          diagnostic_club_access: boolean
          granted_at: string
          granted_by: string | null
          id: string
          manage_competitions: boolean
          manage_fixture_support: boolean
          manage_global_lookups: boolean
          manage_permissions: boolean
          manage_seasons: boolean
          manage_team_catalogue: boolean
          revoked_at: string | null
          revoked_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_role?: string
          created_at?: string
          diagnostic_club_access?: boolean
          granted_at?: string
          granted_by?: string | null
          id?: string
          manage_competitions?: boolean
          manage_fixture_support?: boolean
          manage_global_lookups?: boolean
          manage_permissions?: boolean
          manage_seasons?: boolean
          manage_team_catalogue?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_role?: string
          created_at?: string
          diagnostic_club_access?: boolean
          granted_at?: string
          granted_by?: string | null
          id?: string
          manage_competitions?: boolean
          manage_fixture_support?: boolean
          manage_global_lookups?: boolean
          manage_permissions?: boolean
          manage_seasons?: boolean
          manage_team_catalogue?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_ticket_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          ticket_id: string
          uploaded_by_user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          ticket_id: string
          uploaded_by_user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          ticket_id?: string
          uploaded_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_events: {
        Row: {
          actor_user_id: string | null
          body: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          ticket_id: string
          visibility: string
        }
        Insert: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          ticket_id: string
          visibility: string
        }
        Update: {
          actor_user_id?: string | null
          body?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          ticket_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          closed_at: string | null
          closed_by: string | null
          club_id: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          created_by_user_id: string | null
          description: string
          id: string
          origin: string
          reference: string
          related_fixture_id: string | null
          related_fixture_request_id: string | null
          related_team_id: string | null
          source_route: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          category: string
          closed_at?: string | null
          closed_by?: string | null
          club_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description: string
          id?: string
          origin?: string
          reference: string
          related_fixture_id?: string | null
          related_fixture_request_id?: string | null
          related_team_id?: string | null
          source_route?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          category?: string
          closed_at?: string | null
          closed_by?: string | null
          club_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string
          id?: string
          origin?: string
          reference?: string
          related_fixture_id?: string | null
          related_fixture_request_id?: string | null
          related_team_id?: string | null
          source_route?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "support_tickets_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_related_fixture_id_fkey"
            columns: ["related_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_related_fixture_id_fkey"
            columns: ["related_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_related_fixture_request_id_fkey"
            columns: ["related_fixture_request_id"]
            isOneToOne: false
            referencedRelation: "fixture_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_related_team_id_fkey"
            columns: ["related_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "support_tickets_related_team_id_fkey"
            columns: ["related_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "support_tickets_related_team_id_fkey"
            columns: ["related_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "support_tickets_related_team_id_fkey"
            columns: ["related_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "support_tickets_related_team_id_fkey"
            columns: ["related_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_aliases: {
        Row: {
          alias: string
          set_at: string
          set_by: string | null
          team_id: string
        }
        Insert: {
          alias: string
          set_at?: string
          set_by?: string | null
          team_id: string
        }
        Update: {
          alias?: string
          set_at?: string
          set_by?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "team_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "team_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "team_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "team_aliases_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "team_contacts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "team_contacts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "team_contacts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "team_contacts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_conversations: {
        Row: {
          active: boolean
          created_at: string
          disabled_at: string | null
          disabled_by: string | null
          enabled_at: string | null
          enabled_by: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          enabled_at?: string | null
          enabled_by?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          enabled_at?: string | null
          enabled_by?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_conversations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "team_conversations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "team_conversations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "team_conversations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "team_conversations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_permissions: {
        Row: {
          assigned_group_id: string | null
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          permission: string
          team_id: string
        }
        Insert: {
          assigned_group_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          permission: string
          team_id: string
        }
        Update: {
          assigned_group_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          permission?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_permissions_assigned_group_id_fkey"
            columns: ["assigned_group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "team_permissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "team_permissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "team_permissions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
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
      team_season_identity: {
        Row: {
          age_group: string | null
          category: string
          created_at: string
          display_name: string
          gender: string | null
          season_id: string
          squad_designation: string | null
          team_id: string
        }
        Insert: {
          age_group?: string | null
          category: string
          created_at?: string
          display_name: string
          gender?: string | null
          season_id: string
          squad_designation?: string | null
          team_id: string
        }
        Update: {
          age_group?: string | null
          category?: string
          created_at?: string
          display_name?: string
          gender?: string | null
          season_id?: string
          squad_designation?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_season_identity_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_season_identity_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "team_season_identity_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "team_season_identity_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "team_season_identity_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "team_season_identity_team_id_fkey"
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
          archived_at: string | null
          archived_by: string | null
          canonical_team_type_id: string | null
          category: string
          club_id: string
          created_at: string
          created_by: string | null
          display_name: string
          fold_reason: string | null
          folded_at: string | null
          folded_by: string | null
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
          archived_at?: string | null
          archived_by?: string | null
          canonical_team_type_id?: string | null
          category: string
          club_id: string
          created_at?: string
          created_by?: string | null
          display_name: string
          fold_reason?: string | null
          folded_at?: string | null
          folded_by?: string | null
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
          archived_at?: string | null
          archived_by?: string | null
          canonical_team_type_id?: string | null
          category?: string
          club_id?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          fold_reason?: string | null
          folded_at?: string | null
          folded_by?: string | null
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
            foreignKeyName: "teams_canonical_team_type_id_fkey"
            columns: ["canonical_team_type_id"]
            isOneToOne: false
            referencedRelation: "canonical_team_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
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
      tournament_participants: {
        Row: {
          canonical_team_type_id: string
          club_directory_id: string
          club_id: string | null
          created_at: string
          id: string
          invited_at: string
          invited_by: string | null
          responded_at: string | null
          responded_by: string | null
          status: string
          team_id: string | null
          tournament_id: string
          updated_at: string
        }
        Insert: {
          canonical_team_type_id: string
          club_directory_id: string
          club_id?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          team_id?: string | null
          tournament_id: string
          updated_at?: string
        }
        Update: {
          canonical_team_type_id?: string
          club_directory_id?: string
          club_id?: string | null
          created_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          team_id?: string | null
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_participants_canonical_team_type_id_fkey"
            columns: ["canonical_team_type_id"]
            isOneToOne: false
            referencedRelation: "canonical_team_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_participants_club_directory_id_fkey"
            columns: ["club_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_directory_id_fkey"
            columns: ["club_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_directory_id_fkey"
            columns: ["club_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "tournament_participants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "tournament_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "tournament_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "tournament_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "tournament_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_participants_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "club_visible_tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_participants_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          competition_edition_id: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          event_date: string
          host_club_id: string | null
          host_directory_id: string
          host_team_id: string | null
          id: string
          kickoff_time: string | null
          notes: string | null
          pitch_id: string | null
          rugby_code: string
          season_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
          venue_id: string | null
          venue_notes: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          competition_edition_id?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          event_date: string
          host_club_id?: string | null
          host_directory_id: string
          host_team_id?: string | null
          id?: string
          kickoff_time?: string | null
          notes?: string | null
          pitch_id?: string | null
          rugby_code: string
          season_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          venue_id?: string | null
          venue_notes?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          competition_edition_id?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          event_date?: string
          host_club_id?: string | null
          host_directory_id?: string
          host_team_id?: string | null
          id?: string
          kickoff_time?: string | null
          notes?: string | null
          pitch_id?: string | null
          rugby_code?: string
          season_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          venue_id?: string | null
          venue_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_competition_edition_id_fkey"
            columns: ["competition_edition_id"]
            isOneToOne: false
            referencedRelation: "competition_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_host_directory_id_fkey"
            columns: ["host_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "tournaments_host_directory_id_fkey"
            columns: ["host_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "tournaments_host_directory_id_fkey"
            columns: ["host_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sessions: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          club_id: string
          created_at: string
          created_by: string | null
          end_time: string | null
          id: string
          notes: string | null
          pitch_id: string | null
          scheduling_group_id: string | null
          session_date: string
          start_time: string | null
          team_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          pitch_id?: string | null
          scheduling_group_id?: string | null
          session_date: string
          start_time?: string | null
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          pitch_id?: string | null
          scheduling_group_id?: string | null
          session_date?: string
          start_time?: string | null
          team_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "training_sessions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_scheduling_group_id_fkey"
            columns: ["scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "training_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "training_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "training_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "training_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "unresolved_names_resolved_directory_id_fkey"
            columns: ["resolved_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "unresolved_names_resolved_directory_id_fkey"
            columns: ["resolved_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      user_session_versions: {
        Row: {
          set_at: string
          user_id: string
          version: number
        }
        Insert: {
          set_at?: string
          user_id: string
          version: number
        }
        Update: {
          set_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      venues: {
        Row: {
          active: boolean
          address: string | null
          club_id: string | null
          created_at: string
          created_by: string | null
          directions: string | null
          id: string
          is_default_home: boolean
          latitude: number | null
          longitude: number | null
          name: string
          postcode: string | null
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
          directions?: string | null
          id?: string
          is_default_home?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          postcode?: string | null
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
          directions?: string | null
          id?: string
          is_default_home?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          postcode?: string | null
          slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "venues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
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
      admin_club_overview: {
        Row: {
          activated_at: string | null
          address: string | null
          address_display: string | null
          bio: string | null
          club_admin_count: number | null
          club_id: string | null
          club_status: string | null
          club_updated_at: string | null
          club_website: string | null
          constituent_body: string | null
          country: string | null
          county: string | null
          directory_active: boolean | null
          directory_created_at: string | null
          directory_id: string | null
          directory_logo_storage_path: string | null
          directory_updated_at: string | null
          directory_website: string | null
          external_id: string | null
          facebook_url: string | null
          flag_duplicate_external_id: boolean | null
          flag_duplicate_normalized_key: boolean | null
          flag_inactive: boolean | null
          flag_missing_logo: boolean | null
          flag_missing_postcode: boolean | null
          flag_missing_rugby_code: boolean | null
          flag_missing_town: boolean | null
          flag_missing_website: boolean | null
          flag_no_public_profile: boolean | null
          flag_pending_claim: boolean | null
          flag_unverified: boolean | null
          home_ground: string | null
          is_activated: boolean | null
          legacy_logo_path: string | null
          logo_storage_path: string | null
          name: string | null
          nation: string | null
          normalized_key: string | null
          notes: string | null
          official_email: string | null
          postcode: string | null
          region: string | null
          rugby_code: string | null
          slug: string | null
          source: string | null
          source_updated_at: string | null
          source_url: string | null
          town: string | null
          verification_status: string | null
        }
        Relationships: []
      }
      admin_fixture_overview: {
        Row: {
          away_club_directory_id: string | null
          away_club_name: string | null
          away_club_resolved: boolean | null
          away_score: number | null
          away_team_age_group: string | null
          away_team_category: string | null
          away_team_gender: string | null
          away_team_id: string | null
          away_team_name: string | null
          away_team_squad_designation: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          competition_edition_id: string | null
          competition_name: string | null
          created_at: string | null
          game_type: string | null
          home_away: string | null
          home_club_directory_id: string | null
          home_club_name: string | null
          home_club_resolved: boolean | null
          home_score: number | null
          home_team_age_group: string | null
          home_team_category: string | null
          home_team_gender: string | null
          home_team_id: string | null
          home_team_name: string | null
          home_team_squad_designation: string | null
          id: string | null
          is_primary_mirror: boolean | null
          kickoff_date: string | null
          kickoff_time: string | null
          message_count: number | null
          mirror_fixture_id: string | null
          notes: string | null
          opponent_club_id: string | null
          opponent_club_logo_path: string | null
          opponent_club_name: string | null
          opponent_directory_id: string | null
          opponent_scheduling_group_id: string | null
          opponent_team_age_group: string | null
          opponent_team_category: string | null
          opponent_team_gender: string | null
          opponent_team_id: string | null
          opponent_team_name: string | null
          opponent_team_rugby_code: string | null
          opponent_team_squad_designation: string | null
          owning_club_id: string | null
          owning_club_logo_path: string | null
          owning_club_name: string | null
          owning_directory_id: string | null
          owning_scheduling_group_id: string | null
          owning_team_category: string | null
          owning_team_id: string | null
          owning_team_name: string | null
          pitch_allocation: string | null
          pitch_id: string | null
          pitch_name: string | null
          raw_opposition_text: string | null
          replaces_fixture_id: string | null
          result_amendment_proposed_away_score: number | null
          result_amendment_proposed_home_score: number | null
          result_confirmed_at: string | null
          result_status: string | null
          result_submitted_at: string | null
          rugby_code: string | null
          season_canonical_name: string | null
          season_id: string | null
          season_label: string | null
          source: string | null
          status: string | null
          updated_at: string | null
          venue_id: string | null
          venue_name: string | null
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
            foreignKeyName: "fixtures_mirror_fixture_id_fkey"
            columns: ["mirror_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_mirror_fixture_id_fkey"
            columns: ["mirror_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_directory_id_fkey"
            columns: ["opponent_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_scheduling_group_id_fkey"
            columns: ["opponent_scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixtures_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_owning_scheduling_group_id_fkey"
            columns: ["owning_scheduling_group_id"]
            isOneToOne: false
            referencedRelation: "scheduling_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "fixtures_owning_team_id_fkey"
            columns: ["owning_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_replaces_fixture_id_fkey"
            columns: ["replaces_fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_replaces_fixture_id_fkey"
            columns: ["replaces_fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
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
      admin_message_overview: {
        Row: {
          conversation_key: string | null
          first_message_at: string | null
          fixture_id: string | null
          fixture_opponent_club_id: string | null
          fixture_opponent_club_logo_path: string | null
          fixture_opponent_club_name: string | null
          fixture_opponent_team_id: string | null
          fixture_opponent_team_name: string | null
          fixture_owning_club_id: string | null
          fixture_owning_club_logo_path: string | null
          fixture_owning_club_name: string | null
          fixture_owning_team_id: string | null
          fixture_owning_team_name: string | null
          fixture_request_id: string | null
          has_open_report: boolean | null
          kind: string | null
          last_activity_at: string | null
          message_count: number | null
          open_report_count: number | null
          request_opponent_club_id: string | null
          request_opponent_club_logo_path: string | null
          request_opponent_club_name: string | null
          request_requesting_club_id: string | null
          request_requesting_club_logo_path: string | null
          request_requesting_club_name: string | null
          request_requesting_team_id: string | null
          request_requesting_team_name: string | null
          request_target_team_id: string | null
          request_target_team_name: string | null
          reviewed_report_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fixture_messages_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_messages_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixture_messages_fixture_request_id_fkey"
            columns: ["fixture_request_id"]
            isOneToOne: false
            referencedRelation: "fixture_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_user_overview: {
        Row: {
          account_status: string | null
          club_names: string | null
          email: string | null
          first_name: string | null
          has_active_membership: boolean | null
          has_club_admin: boolean | null
          has_fixtures_admin: boolean | null
          has_pending_request: boolean | null
          has_team_admin: boolean | null
          highest_role: number | null
          is_site_admin: boolean | null
          memberships: Json | null
          pending_requests: Json | null
          surname: string | null
          team_names: string | null
          user_created_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      club_visible_tournaments: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          competition_edition_id: string | null
          conversation_id: string | null
          created_at: string | null
          created_by: string | null
          event_date: string | null
          host_club_id: string | null
          host_directory_id: string | null
          host_team_id: string | null
          id: string | null
          kickoff_time: string | null
          notes: string | null
          pitch_id: string | null
          rugby_code: string | null
          season_id: string | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
          venue_id: string | null
          venue_notes: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_competition_edition_id_fkey"
            columns: ["competition_edition_id"]
            isOneToOne: false
            referencedRelation: "competition_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["opponent_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_opponent_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_club_id"]
          },
          {
            foreignKeyName: "tournaments_host_club_id_fkey"
            columns: ["host_club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_host_directory_id_fkey"
            columns: ["host_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_club_overview"
            referencedColumns: ["directory_id"]
          },
          {
            foreignKeyName: "tournaments_host_directory_id_fkey"
            columns: ["host_directory_id"]
            isOneToOne: false
            referencedRelation: "admin_fixture_overview"
            referencedColumns: ["owning_directory_id"]
          },
          {
            foreignKeyName: "tournaments_host_directory_id_fkey"
            columns: ["host_directory_id"]
            isOneToOne: false
            referencedRelation: "club_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_opponent_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["fixture_owning_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_requesting_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "admin_message_overview"
            referencedColumns: ["request_target_team_id"]
          },
          {
            foreignKeyName: "tournaments_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_pitch_id_fkey"
            columns: ["pitch_id"]
            isOneToOne: false
            referencedRelation: "club_pitches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      team_result_stats: {
        Row: {
          drawn: number | null
          lost: number | null
          played: number | null
          points_against: number | null
          points_for: number | null
          team_id: string | null
          won: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_directory_research_proposal: {
        Args: { p_proposal_id: string }
        Returns: undefined
      }
      accept_fixture_request: {
        Args: { p_request_id: string; p_target_team_id?: string }
        Returns: string
      }
      accept_fixture_request_with_team_action: {
        Args: {
          p_consent_team_action?: boolean
          p_request_id: string
          p_target_team_id?: string
        }
        Returns: string
      }
      accept_guardian_invitation: {
        Args: { p_token: string }
        Returns: {
          club_id: string
          invitation_id: string
          team_id: string
        }[]
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      accept_player_account_invitation: {
        Args: { p_token: string }
        Returns: string
      }
      accept_site_admin_invitation: {
        Args: { p_token: string }
        Returns: undefined
      }
      add_child_for_guardian: {
        Args: {
          p_club_id: string
          p_date_of_birth: string
          p_first_name: string
          p_rugby_code: string
          p_surname: string
        }
        Returns: {
          age_grade: string
          player_id: string
          result: string
          school_year: number
          team_id: string
        }[]
      }
      add_fixture_conversation_participant: {
        Args: {
          p_fixture_id: string
          p_fixture_request_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      add_support_followup: {
        Args: { p_body: string; p_ticket_id: string }
        Returns: undefined
      }
      add_support_internal_note: {
        Args: { p_body: string; p_ticket_id: string }
        Returns: undefined
      }
      admin_get_message_thread_content: {
        Args: { p_fixture_id?: string; p_fixture_request_id?: string }
        Returns: {
          body: string
          created_at: string
          id: string
          report_reason: string
          report_status: string
          sender_name: string
          sender_user_id: string
        }[]
      }
      admin_message_analytics: {
        Args: {
          p_club_id?: string
          p_conversation_type?: string
          p_date_from?: string
          p_date_to?: string
          p_team_id?: string
        }
        Returns: {
          active_conversation_count: number
          attachment_storage_bytes: number
          contact_card_count: number
          conversation_count: number
          direct_attachment_count: number
          image_upload_count: number
          library_share_count: number
          messages_in_range: number
          other_file_upload_count: number
          participating_club_count: number
          participating_team_count: number
          total_messages: number
        }[]
      }
      approve_club_claim: {
        Args: { p_claim_id: string; p_notes?: string }
        Returns: string
      }
      approve_club_join_request: {
        Args: { p_notes?: string; p_request_id: string }
        Returns: undefined
      }
      approve_directory_request: {
        Args: { p_notes?: string; p_request_id: string; p_rugby_code: string }
        Returns: string
      }
      approve_pending_team_membership: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      archive_season: {
        Args: { p_active: boolean; p_season_id: string }
        Returns: undefined
      }
      can_send_team_conversation: {
        Args: { p_team_id: string }
        Returns: boolean
      }
      can_view_team_conversation: {
        Args: { p_team_id: string }
        Returns: boolean
      }
      cancel_training_session: {
        Args: { p_reason?: string; p_session_id: string }
        Returns: undefined
      }
      check_incoming_request_target: {
        Args: { p_request_id: string }
        Returns: {
          existing_team_id: string
          message: string
          resolution: string
        }[]
      }
      check_tournament_participant_target: {
        Args: { p_participant_id: string }
        Returns: {
          existing_team_id: string
          message: string
          resolution: string
        }[]
      }
      claim_external_fixture_result: {
        Args: {
          p_away_score: number
          p_fixture_id: string
          p_home_score: number
          p_note?: string
          p_team_id: string
        }
        Returns: undefined
      }
      claim_tournament_host: {
        Args: { p_host_team_id: string; p_tournament_id: string }
        Returns: undefined
      }
      clear_team_alias: { Args: { p_team_id: string }; Returns: undefined }
      confirm_mixed_boundary_rollover: {
        Args: {
          p_boys_squad_designation?: string
          p_create_girls_team: boolean
          p_girls_squad_designation?: string
          p_proposal_id: string
        }
        Returns: {
          boys_team_id: string
          girls_team_id: string
        }[]
      }
      confirm_rollover_team_proposal: {
        Args: {
          p_action: string
          p_age_group?: string
          p_fold_reason?: string
          p_gender?: string
          p_proposal_id: string
          p_squad_designation?: string
        }
        Returns: undefined
      }
      correct_club_rugby_code: {
        Args: { p_directory_id: string; p_new_code: string; p_reason: string }
        Returns: undefined
      }
      create_canonical_team_type: {
        Args: {
          p_age_group: string
          p_allows_squads?: boolean
          p_category: string
          p_fixed_squad_designation?: string
          p_gender: string
        }
        Returns: string
      }
      create_club_pitch: {
        Args: {
          p_club_id: string
          p_description?: string
          p_display_name: string
        }
        Returns: string
      }
      create_competition: {
        Args: {
          p_area_ids?: string[]
          p_description: string
          p_is_national: boolean
          p_name: string
          p_rugby_code: string
        }
        Returns: string
      }
      create_competition_edition: {
        Args: { p_competition_id: string; p_season_id: string }
        Returns: string
      }
      create_fixture_message_with_attachment: {
        Args: {
          p_body: string
          p_fixture_id: string
          p_fixture_request_id: string
          p_mime_type: string
          p_original_filename: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
      create_missing_target_team: {
        Args: { p_request_id: string }
        Returns: string
      }
      create_missing_tournament_team: {
        Args: { p_participant_id: string }
        Returns: string
      }
      create_next_season_scheduling_group: {
        Args: {
          p_alias?: string
          p_source_group_id: string
          p_team_ids: string[]
          p_to_season_id: string
        }
        Returns: string
      }
      create_partner_invitation: {
        Args: {
          p_club_directory_id: string
          p_contact_email: string
          p_contact_name: string
          p_inviting_club_id: string
        }
        Returns: string
      }
      create_player_for_guardian: {
        Args: {
          p_date_of_birth: string
          p_first_name: string
          p_guardian_invitation_id: string
          p_surname: string
        }
        Returns: {
          player_id: string
          result: string
        }[]
      }
      create_scheduling_group: {
        Args: { p_club_id: string; p_season_id: string; p_team_ids: string[] }
        Returns: string
      }
      create_support_ticket: {
        Args: {
          p_category: string
          p_description: string
          p_related_fixture_id?: string
          p_related_fixture_request_id?: string
          p_related_team_id?: string
          p_source_route?: string
          p_subject: string
        }
        Returns: {
          id: string
          reference: string
        }[]
      }
      create_tournament: {
        Args: {
          p_competition_edition_id?: string
          p_event_date: string
          p_host_team_id: string
          p_kickoff_time?: string
          p_notes?: string
          p_pitch_id?: string
          p_venue_id?: string
          p_venue_notes?: string
        }
        Returns: string
      }
      create_training_session: {
        Args: {
          p_club_id: string
          p_end_time?: string
          p_notes?: string
          p_pitch_id?: string
          p_scheduling_group_id: string
          p_session_date: string
          p_start_time?: string
          p_team_id: string
        }
        Returns: string
      }
      create_venue: {
        Args: {
          p_address: string
          p_club_id: string
          p_directions: string
          p_name: string
          p_postcode: string
          p_set_default: boolean
        }
        Returns: string
      }
      deactivate_canonical_team_type: {
        Args: { p_id: string }
        Returns: undefined
      }
      deactivate_club: {
        Args: { p_club_id: string; p_reason: string }
        Returns: number
      }
      deactivate_competition: { Args: { p_id: string }; Returns: undefined }
      deactivate_competition_edition: {
        Args: { p_id: string }
        Returns: undefined
      }
      decide_player_call_up: {
        Args: { p_action: string; p_call_up_id: string; p_reason?: string }
        Returns: undefined
      }
      decide_player_dispensation: {
        Args: {
          p_approve: boolean
          p_governing_body_reference?: string
          p_id: string
          p_reason?: string
          p_stage: string
        }
        Returns: undefined
      }
      delete_canonical_club: {
        Args: { p_confirm_name: string; p_directory_id: string }
        Returns: undefined
      }
      delete_club_document: {
        Args: { p_document_id: string }
        Returns: undefined
      }
      delete_fixture: { Args: { p_fixture_id: string }; Returns: undefined }
      delete_fixture_message_attachment: {
        Args: { p_attachment_id: string }
        Returns: string
      }
      delete_permission_group: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      delete_season_safe: { Args: { p_season_id: string }; Returns: undefined }
      enter_diagnostic_club: { Args: { p_club_id: string }; Returns: string }
      exit_diagnostic_club: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      fail_directory_verification_run: {
        Args: { p_error: string; p_run_id: string }
        Returns: undefined
      }
      fold_team: {
        Args: { p_reason: string; p_team_id: string }
        Returns: number
      }
      generate_rollover_proposal: {
        Args: {
          p_club_id: string
          p_rugby_code: string
          p_to_season_id: string
        }
        Returns: string
      }
      get_canonical_team_type_impact: {
        Args: { p_id: string }
        Returns: {
          active_teams: number
          clubs_affected: number
          future_fixtures: number
          guardians: number
          historical_fixtures: number
          players: number
        }[]
      }
      get_club_member_directory: {
        Args: { p_club_id: string }
        Returns: {
          email: string
          first_name: string
          surname: string
          user_id: string
        }[]
      }
      get_conversation_participant_names: {
        Args: { p_club_ids: string[]; p_user_ids: string[] }
        Returns: {
          avatar_storage_path: string
          first_name: string
          last_active_at: string
          surname: string
          user_id: string
        }[]
      }
      get_directory_verification_freshness: {
        Args: { p_directory_id: string }
        Returns: string
      }
      get_directory_verification_next_batch: {
        Args: { p_batch_size?: number; p_run_id: string }
        Returns: {
          club_name: string
          directory_id: string
        }[]
      }
      get_effective_fixture_participants: {
        Args: { p_fixture_id: string }
        Returns: {
          all_team_ids: string[]
          away_team_ids: string[]
          home_team_ids: string[]
        }[]
      }
      get_effective_fixture_team_ids: {
        Args: { p_fixture_id: string }
        Returns: string[]
      }
      get_effective_message_policy: {
        Args: { p_club_id?: string }
        Returns: {
          allow_contact_card_sharing: boolean
          allow_contact_card_sharing_club_override_allowed: boolean
          allow_contact_card_sharing_origin: string
          allow_direct_attachments: boolean
          allow_direct_attachments_club_override_allowed: boolean
          allow_direct_attachments_origin: string
          allow_document_library_sharing: boolean
          allow_document_library_sharing_club_override_allowed: boolean
          allow_document_library_sharing_origin: string
          allow_image_uploads: boolean
          allow_image_uploads_club_override_allowed: boolean
          allow_image_uploads_origin: string
          allow_participant_management: boolean
          allow_participant_management_club_override_allowed: boolean
          allow_participant_management_origin: string
          allowed_file_types: string[]
          max_attachment_size_bytes: number
        }[]
      }
      get_guardian_invitation_preview: {
        Args: { p_token: string }
        Returns: {
          accepted_by: string
          club_name: string
          expires_at: string
          invitation_id: string
          invited_email: string
          replacement_for_player_first_name: string
          replacement_for_player_id: string
          status: string
          team_alias: string
          team_display_name: string
        }[]
      }
      get_invitation_preview: {
        Args: { p_token: string }
        Returns: {
          club_name: string
          club_role: string
          declared_role: string
          expires_at: string
          invited_email: string
          status: string
        }[]
      }
      get_partner_team_availability: {
        Args: { p_from: string; p_team_id: string; p_to: string }
        Returns: {
          availability: string
          fixture_date: string
        }[]
      }
      get_player_account_invitation_preview: {
        Args: { p_token: string }
        Returns: {
          accepted_by: string
          expires_at: string
          invitation_id: string
          invited_email: string
          player_first_name: string
          status: string
        }[]
      }
      get_player_permission_summary: {
        Args: { p_player_id: string }
        Returns: {
          co_guardians_pending: boolean
          description: string
          effective: boolean
          label: string
          max_age: number
          min_age: number
          my_decision: boolean
          permission_key: string
        }[]
      }
      get_scheduling_group_availability: {
        Args: { p_from: string; p_group_id: string; p_to: string }
        Returns: {
          availability: string
          fixture_date: string
        }[]
      }
      get_site_admin_invitation_preview: {
        Args: { p_token: string }
        Returns: {
          admin_role: string
          expires_at: string
          invited_email: string
          status: string
        }[]
      }
      get_team_guardian_directory: {
        Args: { p_team_id: string }
        Returns: {
          guardian_email: string
          guardian_first_name: string
          guardian_id: string
          guardian_surname: string
          guardian_user_id: string
          player_first_name: string
          player_id: string
          player_surname: string
          relationship_type: string
        }[]
      }
      get_team_identities_for_season_batch: {
        Args: { p_pairs: Json }
        Returns: {
          age_group: string
          category: string
          display_name: string
          gender: string
          is_projected: boolean
          season_id: string
          squad_designation: string
          team_id: string
        }[]
      }
      get_team_identity_for_season: {
        Args: { p_season_id: string; p_team_id: string }
        Returns: {
          age_group: string
          category: string
          display_name: string
          gender: string
          is_projected: boolean
          squad_designation: string
        }[]
      }
      graduate_team: { Args: { p_team_id: string }; Returns: number }
      has_capability: {
        Args: {
          p_capability_key: string
          p_club_id?: string
          p_scope_type: string
          p_team_id?: string
        }
        Returns: boolean
      }
      invite_player_account: {
        Args: { p_email: string; p_player_id: string }
        Returns: string
      }
      invite_tournament_participant: {
        Args: {
          p_canonical_team_type_id: string
          p_club_directory_id: string
          p_tournament_id: string
        }
        Returns: string
      }
      leave_fixture_conversation: {
        Args: { p_fixture_id: string; p_fixture_request_id: string }
        Returns: undefined
      }
      link_guardian_to_existing_player: {
        Args: { p_guardian_invitation_id: string; p_player_id: string }
        Returns: undefined
      }
      list_addable_club_members: {
        Args: { p_fixture_id: string; p_fixture_request_id: string }
        Returns: {
          name: string
          user_id: string
        }[]
      }
      list_directory_verification_runs: {
        Args: { p_limit?: number }
        Returns: {
          completed_at: string | null
          conflicts_found: number
          failed_count: number
          id: string
          last_error: string | null
          no_result_count: number
          processed_records: number
          proposals_created: number
          scope: string
          scope_filter: Json | null
          started_at: string
          started_by: string
          status: string
          total_records: number
        }[]
        SetofOptions: {
          from: "*"
          to: "directory_verification_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_fixtures_since_deactivation: {
        Args: { p_club_id: string }
        Returns: {
          away_score: number | null
          away_team_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_due_to_fold: boolean
          changing_room: string | null
          competition_edition_id: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          event_type: string | null
          game_type: string | null
          home_away: string
          home_score: number | null
          home_team_id: string | null
          id: string
          import_batch_id: string | null
          kickoff_amendment_proposed_at: string | null
          kickoff_amendment_proposed_by: string | null
          kickoff_amendment_proposed_by_club_id: string | null
          kickoff_amendment_proposed_date: string | null
          kickoff_amendment_proposed_time: string | null
          kickoff_date: string
          kickoff_time: string | null
          legacy_fixture_ref: string | null
          mirror_fixture_id: string | null
          notes: string | null
          opponent_directory_id: string | null
          opponent_scheduling_group_id: string | null
          opponent_team_age_group_snapshot: string | null
          opponent_team_display_name_snapshot: string | null
          opponent_team_id: string | null
          owning_scheduling_group_id: string | null
          owning_team_age_group_snapshot: string | null
          owning_team_display_name_snapshot: string | null
          owning_team_id: string
          pitch_allocation: string | null
          pitch_id: string | null
          raw_opposition_text: string
          replaces_fixture_id: string | null
          restoration_requested_at: string | null
          restoration_requested_by: string | null
          result_amendment_proposed_at: string | null
          result_amendment_proposed_away_score: number | null
          result_amendment_proposed_by: string | null
          result_amendment_proposed_by_club_id: string | null
          result_amendment_proposed_home_score: number | null
          result_confirmed_at: string | null
          result_confirmed_by: string | null
          result_deadline_at: string | null
          result_site_admin_resolution_reason: string | null
          result_site_admin_resolved_at: string | null
          result_site_admin_resolved_by: string | null
          result_status: string
          result_submitted_at: string | null
          result_submitted_by: string | null
          result_submitted_by_club_id: string | null
          season_id: string | null
          season_label: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
          venue_address: string | null
          venue_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "fixtures"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_restorable_fixtures: {
        Args: { p_team_id: string }
        Returns: {
          away_score: number | null
          away_team_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_due_to_fold: boolean
          changing_room: string | null
          competition_edition_id: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          event_type: string | null
          game_type: string | null
          home_away: string
          home_score: number | null
          home_team_id: string | null
          id: string
          import_batch_id: string | null
          kickoff_amendment_proposed_at: string | null
          kickoff_amendment_proposed_by: string | null
          kickoff_amendment_proposed_by_club_id: string | null
          kickoff_amendment_proposed_date: string | null
          kickoff_amendment_proposed_time: string | null
          kickoff_date: string
          kickoff_time: string | null
          legacy_fixture_ref: string | null
          mirror_fixture_id: string | null
          notes: string | null
          opponent_directory_id: string | null
          opponent_scheduling_group_id: string | null
          opponent_team_age_group_snapshot: string | null
          opponent_team_display_name_snapshot: string | null
          opponent_team_id: string | null
          owning_scheduling_group_id: string | null
          owning_team_age_group_snapshot: string | null
          owning_team_display_name_snapshot: string | null
          owning_team_id: string
          pitch_allocation: string | null
          pitch_id: string | null
          raw_opposition_text: string
          replaces_fixture_id: string | null
          restoration_requested_at: string | null
          restoration_requested_by: string | null
          result_amendment_proposed_at: string | null
          result_amendment_proposed_away_score: number | null
          result_amendment_proposed_by: string | null
          result_amendment_proposed_by_club_id: string | null
          result_amendment_proposed_home_score: number | null
          result_confirmed_at: string | null
          result_confirmed_by: string | null
          result_deadline_at: string | null
          result_site_admin_resolution_reason: string | null
          result_site_admin_resolved_at: string | null
          result_site_admin_resolved_by: string | null
          result_status: string
          result_submitted_at: string | null
          result_submitted_by: string | null
          result_submitted_by_club_id: string | null
          season_id: string | null
          season_label: string | null
          source: string
          status: string
          updated_at: string
          updated_by: string | null
          venue_address: string | null
          venue_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "fixtures"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_suspended_club_memberships: {
        Args: { p_club_id: string }
        Returns: {
          authority_suspended_at: string
          first_name: string
          membership_id: string
          role: string
          surname: string
          user_id: string
        }[]
      }
      mark_graduating_player_left: {
        Args: { p_queue_id: string }
        Returns: undefined
      }
      mark_message_report_reviewed: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      moderator_delete_message: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      place_graduating_player: {
        Args: { p_queue_id: string; p_target_team_id: string }
        Returns: undefined
      }
      preview_directory_verification_scope: {
        Args: { p_directory_id?: string; p_filters?: Json; p_scope: string }
        Returns: number
      }
      preview_my_fixture_contact_card: {
        Args: { p_fixture_id: string; p_fixture_request_id: string }
        Returns: {
          club_name: string
          display_name: string
          role_label: string
          team_name: string
          telephone: string
        }[]
      }
      preview_player_movement_eligibility: {
        Args: {
          p_player_id: string
          p_source_team_id: string
          p_target_team_id: string
        }
        Returns: {
          approval_type: string
          governing_body: string
          reason: string
          requirement: string
          restrictions: string
          rule_reference: string
        }[]
      }
      propose_tournament_at_host: {
        Args: {
          p_event_date: string
          p_kickoff_time?: string
          p_notes?: string
          p_proposed_host_directory_id: string
          p_proposing_team_id: string
        }
        Returns: string
      }
      publish_import_row: { Args: { p_row_id: string }; Returns: string }
      reactivate_club: { Args: { p_club_id: string }; Returns: undefined }
      reactivate_missing_target_team: {
        Args: { p_request_id: string }
        Returns: string
      }
      reactivate_missing_tournament_team: {
        Args: { p_participant_id: string }
        Returns: string
      }
      reactivate_team: { Args: { p_team_id: string }; Returns: undefined }
      reconcile_overdue_fixture_results: { Args: never; Returns: number }
      reconcile_tournament_participant: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      record_directory_verification_result: {
        Args: {
          p_detail?: string
          p_directory_id: string
          p_outcome: string
          p_proposals?: Database["public"]["CompositeTypes"]["directory_verification_proposal_input"][]
          p_run_id: string
        }
        Returns: undefined
      }
      record_session_version: {
        Args: { p_version: number }
        Returns: undefined
      }
      reject_club_claim: {
        Args: { p_claim_id: string; p_notes?: string }
        Returns: undefined
      }
      reject_club_join_request: {
        Args: { p_notes?: string; p_request_id: string }
        Returns: undefined
      }
      reject_directory_request: {
        Args: { p_notes?: string; p_request_id: string }
        Returns: undefined
      }
      reject_directory_research_proposal: {
        Args: { p_proposal_id: string; p_reason?: string }
        Returns: undefined
      }
      reject_fixture_kickoff_change: {
        Args: { p_fixture_id: string }
        Returns: undefined
      }
      reject_pending_team_membership: {
        Args: { p_membership_id: string; p_reason: string }
        Returns: undefined
      }
      rejoin_fixture_conversation: {
        Args: { p_fixture_id: string; p_fixture_request_id: string }
        Returns: undefined
      }
      remove_fixture_conversation_participant: {
        Args: {
          p_fixture_id: string
          p_fixture_request_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      remove_guardian_relationship: {
        Args: { p_guardian_id: string; p_reason: string }
        Returns: {
          orphaned: boolean
        }[]
      }
      remove_tournament_participant: {
        Args: { p_participant_id: string }
        Returns: undefined
      }
      rename_club_pitch: {
        Args: { p_new_name: string; p_pitch_id: string }
        Returns: undefined
      }
      reorder_club_pitches: {
        Args: { p_club_id: string; p_pitch_ids: string[] }
        Returns: undefined
      }
      report_fixture_message: {
        Args: { p_message_id: string; p_reason: string }
        Returns: undefined
      }
      request_fixture_restoration: {
        Args: { p_fixture_id: string }
        Returns: string
      }
      request_player_call_up: {
        Args: {
          p_eligibility_rule_reference: string
          p_fixture_id: string
          p_player_id: string
          p_source_team_id: string
          p_target_team_id: string
        }
        Returns: string
      }
      request_player_dispensation: {
        Args: {
          p_eligibility_rule_reference: string
          p_player_id: string
          p_season_id: string
          p_source_team_id: string
          p_target_team_id: string
        }
        Returns: string
      }
      resolve_canonical_team_type_id: {
        Args: {
          p_age_group: string
          p_gender: string
          p_squad_designation?: string
        }
        Returns: string
      }
      resolve_diagnostic_session: {
        Args: { p_session_id: string }
        Returns: {
          club_id: string
          club_logo_storage_path: string
          club_name: string
          entered_at: string
        }[]
      }
      resolve_fixture_result_dispute: {
        Args: {
          p_away_score: number
          p_fixture_id: string
          p_home_score: number
          p_reason: string
        }
        Returns: undefined
      }
      resolve_message_report: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      resolve_player_duplicate_review_as_existing: {
        Args: { p_review_id: string }
        Returns: undefined
      }
      resolve_player_duplicate_review_as_new: {
        Args: { p_review_id: string }
        Returns: {
          player_id: string
        }[]
      }
      resolve_rollover_group_flag: {
        Args: { p_flag_id: string }
        Returns: undefined
      }
      respond_to_attendance: {
        Args: { p_fixture_id: string; p_player_id: string; p_status: string }
        Returns: undefined
      }
      respond_to_club_conversation: {
        Args: { p_approve: boolean; p_conversation_id: string }
        Returns: undefined
      }
      respond_to_club_partnership: {
        Args: { p_approve: boolean; p_partnership_id: string }
        Returns: undefined
      }
      respond_tournament_invitation: {
        Args: { p_accept: boolean; p_participant_id: string }
        Returns: undefined
      }
      respond_tournament_invitation_with_team_action: {
        Args: {
          p_accept: boolean
          p_consent_team_action?: boolean
          p_participant_id: string
        }
        Returns: undefined
      }
      restore_club_membership_authority: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      revoke_capability_override: {
        Args: { p_override_id: string }
        Returns: undefined
      }
      revoke_club_partnership: {
        Args: { p_partnership_id: string }
        Returns: undefined
      }
      revoke_player_dispensation: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      revoke_site_admin_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      run_fixture_completion_check: { Args: never; Returns: number }
      run_season_transition_check: { Args: never; Returns: undefined }
      search_scheduling_groups: {
        Args: { p_requesting_team_id: string }
        Returns: {
          club_id: string
          club_name: string
          display_tag: string
          group_id: string
          member_age_group: string
          member_team_id: string
          member_team_name: string
        }[]
      }
      send_fixture_support_message: {
        Args: { p_body: string; p_fixture_id: string }
        Returns: string
      }
      send_replacement_guardian_invitation: {
        Args: {
          p_invited_email: string
          p_player_id: string
          p_team_id: string
        }
        Returns: {
          invitation_id: string
          token: string
        }[]
      }
      send_support_reply: {
        Args: { p_body: string; p_ticket_id: string }
        Returns: undefined
      }
      set_capability_override: {
        Args: {
          p_capability_key: string
          p_club_id: string
          p_effect: string
          p_reason?: string
          p_scope_type: string
          p_team_id: string
          p_user_id: string
        }
        Returns: string
      }
      set_club_pitch_active: {
        Args: { p_active: boolean; p_pitch_id: string }
        Returns: undefined
      }
      set_default_venue: { Args: { p_id: string }; Returns: undefined }
      set_fixture_conversation_mute: {
        Args: {
          p_fixture_id: string
          p_fixture_request_id: string
          p_muted: boolean
        }
        Returns: undefined
      }
      set_guardian_player_permission: {
        Args: {
          p_granted: boolean
          p_permission_key: string
          p_player_id: string
        }
        Returns: undefined
      }
      set_notification_preference: {
        Args: { p_in_app_enabled: boolean; p_topic_key: string }
        Returns: undefined
      }
      set_scheduling_group_active: {
        Args: { p_active: boolean; p_group_id: string }
        Returns: undefined
      }
      set_scheduling_group_alias: {
        Args: { p_alias: string; p_group_id: string }
        Returns: undefined
      }
      set_scheduling_group_members: {
        Args: { p_group_id: string; p_team_ids: string[] }
        Returns: undefined
      }
      set_site_admin_competitions_capability: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_site_admin_diagnostic_capability: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_site_admin_fixture_support_capability: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_site_admin_global_lookups_capability: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_site_admin_permissions_capability: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_site_admin_seasons_capability: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_site_admin_team_catalogue_capability: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: undefined
      }
      set_team_alias: {
        Args: { p_alias: string; p_team_id: string }
        Returns: undefined
      }
      set_venue_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      share_fixture_contact_card: {
        Args: { p_fixture_id: string; p_fixture_request_id: string }
        Returns: string
      }
      share_fixture_document: {
        Args: {
          p_document_id: string
          p_fixture_id: string
          p_fixture_request_id: string
          p_note?: string
        }
        Returns: string
      }
      soft_delete_own_message: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      start_directory_verification_run: {
        Args: { p_directory_id?: string; p_filters?: Json; p_scope: string }
        Returns: string
      }
      start_or_get_club_conversation: {
        Args: {
          p_first_message: string
          p_my_club_id: string
          p_target_club_id: string
        }
        Returns: {
          conversation_id: string
          is_new: boolean
          status: string
        }[]
      }
      submit_fixture_result: {
        Args: {
          p_away_score: number
          p_fixture_id: string
          p_home_score: number
        }
        Returns: undefined
      }
      submit_public_support_ticket: {
        Args: {
          p_category: string
          p_club_context?: string
          p_description: string
          p_email: string
          p_name: string
          p_subject: string
        }
        Returns: string
      }
      swap_fixture_home_away: {
        Args: { p_fixture_id: string }
        Returns: undefined
      }
      touch_last_active: { Args: never; Returns: undefined }
      update_club_message_policy: {
        Args: {
          p_allow_contact_card_sharing: boolean
          p_allow_direct_attachments: boolean
          p_allow_document_library_sharing: boolean
          p_allow_image_uploads: boolean
          p_allow_participant_management: boolean
          p_club_id: string
          p_use_default_contact_card_sharing: boolean
          p_use_default_direct_attachments: boolean
          p_use_default_document_library_sharing: boolean
          p_use_default_image_uploads: boolean
          p_use_default_participant_management: boolean
        }
        Returns: undefined
      }
      update_competition: {
        Args: {
          p_area_ids?: string[]
          p_description: string
          p_id: string
          p_is_national: boolean
          p_name: string
        }
        Returns: undefined
      }
      update_fixture_competition: {
        Args: { p_competition_edition_id: string; p_fixture_id: string }
        Returns: undefined
      }
      update_fixture_kickoff: {
        Args: {
          p_fixture_id: string
          p_kickoff_date: string
          p_kickoff_time?: string
        }
        Returns: undefined
      }
      update_fixture_opposition: {
        Args: {
          p_fixture_id: string
          p_opponent_directory_id: string
          p_opponent_team_id: string
          p_raw_opposition_text: string
        }
        Returns: undefined
      }
      update_fixture_owning_team: {
        Args: { p_fixture_id: string; p_new_owning_team_id: string }
        Returns: undefined
      }
      update_fixture_pitch: {
        Args: {
          p_fixture_id: string
          p_pitch_id?: string
          p_pitch_text?: string
        }
        Returns: undefined
      }
      update_fixture_schedule: {
        Args: {
          p_fixture_id: string
          p_kickoff_date: string
          p_kickoff_time?: string
          p_pitch_id?: string
          p_pitch_text?: string
          p_source?: string
          p_venue_id?: string
        }
        Returns: {
          applied_kickoff_date: string
          applied_kickoff_time: string
          applied_pitch_id: string
          applied_venue_id: string
          kickoff_proposed: boolean
        }[]
      }
      update_fixture_venue: {
        Args: { p_fixture_id: string; p_venue_id?: string }
        Returns: undefined
      }
      update_global_message_policy: {
        Args: {
          p_allow_contact_card_sharing: boolean
          p_allow_contact_card_sharing_club_override_allowed: boolean
          p_allow_direct_attachments: boolean
          p_allow_direct_attachments_club_override_allowed: boolean
          p_allow_document_library_sharing: boolean
          p_allow_document_library_sharing_club_override_allowed: boolean
          p_allow_image_uploads: boolean
          p_allow_image_uploads_club_override_allowed: boolean
          p_allow_participant_management: boolean
          p_allow_participant_management_club_override_allowed: boolean
          p_allowed_file_types: string[]
          p_max_attachment_size_bytes: number
        }
        Returns: undefined
      }
      update_support_ticket_category: {
        Args: { p_new_category: string; p_ticket_id: string }
        Returns: undefined
      }
      update_support_ticket_status: {
        Args: {
          p_internal_note?: string
          p_new_status: string
          p_ticket_id: string
          p_user_message?: string
        }
        Returns: undefined
      }
      update_tournament_venue: {
        Args: { p_tournament_id: string; p_venue_id?: string }
        Returns: undefined
      }
      update_venue: {
        Args: {
          p_address: string
          p_directions: string
          p_id: string
          p_name: string
          p_postcode: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      directory_verification_proposal_input: {
        field: string | null
        current_value: string | null
        proposed_value: string | null
        source: string | null
        source_url: string | null
        confidence: string | null
      }
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

