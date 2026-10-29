export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      openrouter_keys: {
        Row: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          source: string
          status: string
        }
        Insert: {
          ciphertext: string
          code?: number | null
          created_at?: string
          failures?: number
          fingerprint: string
          id?: string
          last_used?: string | null
          quarantined_until?: string | null
          rotation_order?: number
          source?: string
          status?: string
        }
        Update: {
          ciphertext?: string
          code?: number | null
          created_at?: string
          failures?: number
          fingerprint?: string
          id?: string
          last_used?: string | null
          quarantined_until?: string | null
          rotation_order?: number
          source?: string
          status?: string
        }
        Relationships: []
      }
      openrouter_rotation: {
        Row: {
          cursor: number
          id: number
        }
        Insert: {
          cursor?: number
          id?: number
        }
        Update: {
          cursor?: number
          id?: number
        }
        Relationships: []
      }
      provider_api_keys: {
        Row: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          in_flight: number
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          service: string
          source: string
          status: string
        }
        Insert: {
          ciphertext: string
          code?: number | null
          created_at?: string
          failures?: number
          fingerprint: string
          id?: string
          in_flight?: number
          last_used?: string | null
          quarantined_until?: string | null
          rotation_order?: number
          service: string
          source?: string
          status?: string
        }
        Update: {
          ciphertext?: string
          code?: number | null
          created_at?: string
          failures?: number
          fingerprint?: string
          id?: string
          in_flight?: number
          last_used?: string | null
          quarantined_until?: string | null
          rotation_order?: number
          service?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
      provider_key_rotation: {
        Row: {
          cursor: number
          service: string
        }
        Insert: {
          cursor?: number
          service: string
        }
        Update: {
          cursor?: number
          service?: string
        }
        Relationships: []
      }
      provider_usage_events: {
        Row: {
          audio_bytes: number
          cached: boolean
          duration_ms: number
          estimated_input_tokens: number
          id: number
          input_chars: number
          method: string
          occurred_at: string
          output_chars: number
          provider_input_tokens: number | null
          provider_output_tokens: number | null
          service: string
          status: number
          user_id: string | null
        }
        Insert: {
          audio_bytes?: number
          cached?: boolean
          duration_ms?: number
          estimated_input_tokens?: number
          id?: never
          input_chars?: number
          method: string
          occurred_at?: string
          output_chars?: number
          provider_input_tokens?: number | null
          provider_output_tokens?: number | null
          service: string
          status: number
          user_id?: string | null
        }
        Update: {
          audio_bytes?: number
          cached?: boolean
          duration_ms?: number
          estimated_input_tokens?: number
          id?: never
          input_chars?: number
          method?: string
          occurred_at?: string
          output_chars?: number
          provider_input_tokens?: number | null
          provider_output_tokens?: number | null
          service?: string
          status?: number
          user_id?: string | null
        }
        Relationships: []
      }
      user_api_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          last_used: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          last_used?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_used?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      user_provider_api_keys: {
        Row: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          in_flight: number
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          service: string
          status: string
          user_id: string
        }
        Insert: {
          ciphertext: string
          code?: number | null
          created_at?: string
          failures?: number
          fingerprint: string
          id?: string
          in_flight?: number
          last_used?: string | null
          quarantined_until?: string | null
          rotation_order?: number
          service: string
          status?: string
          user_id: string
        }
        Update: {
          ciphertext?: string
          code?: number | null
          created_at?: string
          failures?: number
          fingerprint?: string
          id?: string
          in_flight?: number
          last_used?: string | null
          quarantined_until?: string | null
          rotation_order?: number
          service?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      user_provider_key_events: {
        Row: {
          action: string
          id: number
          key_id: string
          occurred_at: string
          response_code: number
          user_id: string
        }
        Insert: {
          action: string
          id?: never
          key_id: string
          occurred_at?: string
          response_code: number
          user_id: string
        }
        Update: {
          action?: string
          id?: never
          key_id?: string
          occurred_at?: string
          response_code?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_provider_key_events_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "user_provider_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      mark_openrouter_key: {
        Args: { key_id: string; response_code: number }
        Returns: undefined
      }
      mark_provider_key: {
        Args: { key_id: string; response_code: number }
        Returns: undefined
      }
      mark_user_provider_key: {
        Args: {
          action_name?: string
          key_id: string
          owner_id: string
          response_code: number
        }
        Returns: undefined
      }
      provider_usage_report: {
        Args: { report_user_id?: string; window_hours?: number }
        Returns: Json
      }
      reserve_any_provider_key: {
        Args: { excluded_keys?: string[] }
        Returns: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          in_flight: number
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          service: string
          source: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "provider_api_keys"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_any_user_provider_key: {
        Args: { excluded_keys?: string[]; owner_id: string }
        Returns: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          in_flight: number
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          service: string
          status: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_provider_api_keys"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_openrouter_keys: {
        Args: never
        Returns: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          source: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "openrouter_keys"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_provider_key: {
        Args: { excluded_keys?: string[]; service_name: string }
        Returns: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          in_flight: number
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          service: string
          source: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "provider_api_keys"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_user_provider_key: {
        Args: {
          excluded_keys?: string[]
          owner_id: string
          service_name: string
        }
        Returns: {
          ciphertext: string
          code: number | null
          created_at: string
          failures: number
          fingerprint: string
          id: string
          in_flight: number
          last_used: string | null
          quarantined_until: string | null
          rotation_order: number
          service: string
          status: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_provider_api_keys"
          isOneToOne: false
          isSetofReturn: true
        }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
