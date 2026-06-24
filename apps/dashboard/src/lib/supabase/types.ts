/**
 * Hand-authored Database type stubs matching the real schema (0002_core_tables.sql).
 * Replace with `supabase gen types typescript` output once local DB is up.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type AssignmentRole = "primary" | "collaborator";
export type CoverageStatus = "open" | "claimed" | "closed";
export type PipelineStage = "new" | "talking" | "follow_up" | "won" | "lost";
export type MatchBand = "NEW" | "REPEAT" | "UNCERTAIN";
export type HandlerMode = "ai" | "human";
export type SenderType = "ai" | "salesperson" | "customer" | "system";
export type DraftStatus = "pending_approval" | "approved" | "rejected";
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type FollowupStatus = "pending" | "sending" | "sent" | "skipped" | "cancelled";

export interface Database {
  public: {
    Tables: {
      salespersons: {
        Row: {
          id: string;
          auth_uid: string | null;
          name: string;
          whatsapp: string;
          role: "salesperson" | "owner";
          active: boolean;
          available: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["salespersons"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["salespersons"]["Insert"]>;
      };
      customers: {
        Row: {
          id: string;
          consent_id: string;
          name: string | null;
          phone: string | null;
          wa_id: string | null;
          budget_range: string | null;
          primary_interest: string | null;
          ai_followup_enabled: boolean;
          ai_autosend: boolean;
          handler_mode: HandlerMode;
          handler_salesperson_id: string | null;
          handler_since: string | null;
          last_inbound_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["customers"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["customers"]["Insert"]>;
      };
      customer_assignments: {
        Row: {
          id: string;
          customer_id: string;
          salesperson_id: string;
          role: AssignmentRole;
          added_by: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["customer_assignments"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["customer_assignments"]["Insert"]>;
      };
      visits: {
        Row: {
          id: string;
          customer_id: string | null;
          salesperson_id: string | null;
          occurred_at: string;
          match_score: number | null;
          match_band: MatchBand;
          photo_key: string | null;
          raw_event_id: string;
        };
        Insert: Omit<Database["public"]["Tables"]["visits"]["Row"], "id" | "occurred_at">;
        Update: Partial<Database["public"]["Tables"]["visits"]["Insert"]>;
      };
      messages: {
        Row: {
          id: string;
          customer_id: string;
          wamid: string | null;
          direction: "outbound" | "inbound";
          category: string | null;
          template_name: string | null;
          content: string;
          sender_type: SenderType;
          sender_salesperson_id: string | null;
          sent_as_salesperson_id: string | null;
          ai_generated: boolean;
          draft_status: DraftStatus | null;
          approved_by: string | null;
          status: MessageStatus;
          sent_at: string | null;
          received_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["messages"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
      };
      pipeline_stages: {
        Row: {
          customer_id: string;
          stage: PipelineStage;
          closing_notes: string | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["pipeline_stages"]["Row"], "updated_at">;
        Update: Partial<Database["public"]["Tables"]["pipeline_stages"]["Insert"]>;
      };
      followups: {
        Row: {
          id: string;
          customer_id: string;
          scheduled_at: string;
          template_name: string;
          template_vars: Json;
          status: FollowupStatus;
          celery_task_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["followups"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["followups"]["Insert"]>;
      };
    };
    Functions: {
      claim_customer: {
        Args: { p_customer_id: string };
        Returns: boolean;
      };
      current_salesperson_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      is_owner: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
  };
}
