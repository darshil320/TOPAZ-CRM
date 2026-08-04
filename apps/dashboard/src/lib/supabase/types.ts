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
      alerts: {
        Row: {
          created_at: string
          customer_id: string
          detail: string | null
          id: string
          message_id: string | null
          order_id: string | null
          salesperson_id: string | null
          seen_at: string | null
          type: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          detail?: string | null
          id?: string
          message_id?: string | null
          order_id?: string | null
          salesperson_id?: string | null
          seen_at?: string | null
          type: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          detail?: string | null
          id?: string
          message_id?: string | null
          order_id?: string | null
          salesperson_id?: string | null
          seen_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          changed_at: string
          entity: string
          entity_id: string | null
          id: number
          payload: Json | null
        }
        Insert: {
          action: string
          actor?: string | null
          changed_at?: string
          entity: string
          entity_id?: string | null
          id?: never
          payload?: Json | null
        }
        Update: {
          action?: string
          actor?: string | null
          changed_at?: string
          entity?: string
          entity_id?: string | null
          id?: never
          payload?: Json | null
        }
        Relationships: []
      }
      consents: {
        Row: {
          face_tracking: boolean
          given_at: string
          id: string
          ip: string | null
          method: string
          personal_data: boolean
          whatsapp_marketing: boolean
          withdrawn_at: string | null
        }
        Insert: {
          face_tracking?: boolean
          given_at?: string
          id?: string
          ip?: string | null
          method: string
          personal_data?: boolean
          whatsapp_marketing?: boolean
          withdrawn_at?: string | null
        }
        Update: {
          face_tracking?: boolean
          given_at?: string
          id?: string
          ip?: string | null
          method?: string
          personal_data?: boolean
          whatsapp_marketing?: boolean
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          budget: string | null
          created_at: string
          customer_id: string
          id: string
          notes: string | null
          products: string[] | null
          salesperson_id: string | null
          stage_at_time: string | null
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          budget?: string | null
          created_at?: string
          customer_id: string
          id?: string
          notes?: string | null
          products?: string[] | null
          salesperson_id?: string | null
          stage_at_time?: string | null
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          budget?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          notes?: string | null
          products?: string[] | null
          salesperson_id?: string | null
          stage_at_time?: string | null
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_requests: {
        Row: {
          became_primary: boolean
          claimed_by: string | null
          created_at: string
          customer_id: string
          id: string
          requested_by: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["coverage_status"]
          visit_id: string | null
        }
        Insert: {
          became_primary?: boolean
          claimed_by?: string | null
          created_at?: string
          customer_id: string
          id?: string
          requested_by: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["coverage_status"]
          visit_id?: string | null
        }
        Update: {
          became_primary?: boolean
          claimed_by?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          requested_by?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["coverage_status"]
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_requests_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requests_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_assignments: {
        Row: {
          active: boolean
          added_by: string | null
          created_at: string
          customer_id: string
          id: string
          role: Database["public"]["Enums"]["assignment_role"]
          salesperson_id: string
        }
        Insert: {
          active?: boolean
          added_by?: string | null
          created_at?: string
          customer_id: string
          id?: string
          role?: Database["public"]["Enums"]["assignment_role"]
          salesperson_id: string
        }
        Update: {
          active?: boolean
          added_by?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          role?: Database["public"]["Enums"]["assignment_role"]
          salesperson_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_assignments_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_assignments_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          ai_autosend: boolean
          ai_followup_enabled: boolean
          alerts_muted: boolean
          budget_range: string | null
          consent_id: string
          created_at: string
          handler_mode: string
          handler_salesperson_id: string | null
          handler_since: string | null
          id: string
          interest_summary: string | null
          last_inbound_at: string | null
          name: string | null
          phone: string | null
          primary_interest: string | null
          updated_at: string
          wa_id: string | null
        }
        Insert: {
          ai_autosend?: boolean
          ai_followup_enabled?: boolean
          alerts_muted?: boolean
          budget_range?: string | null
          consent_id: string
          created_at?: string
          handler_mode?: string
          handler_salesperson_id?: string | null
          handler_since?: string | null
          id?: string
          interest_summary?: string | null
          last_inbound_at?: string | null
          name?: string | null
          phone?: string | null
          primary_interest?: string | null
          updated_at?: string
          wa_id?: string | null
        }
        Update: {
          ai_autosend?: boolean
          ai_followup_enabled?: boolean
          alerts_muted?: boolean
          budget_range?: string | null
          consent_id?: string
          created_at?: string
          handler_mode?: string
          handler_salesperson_id?: string | null
          handler_since?: string | null
          id?: string
          interest_summary?: string | null
          last_inbound_at?: string | null
          name?: string | null
          phone?: string | null
          primary_interest?: string | null
          updated_at?: string
          wa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "consents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_handler_salesperson_id_fkey"
            columns: ["handler_salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      face_embeddings: {
        Row: {
          customer_id: string
          embedding: string
          enrolled_at: string
          id: string
          model_version: string
          quality_score: number | null
        }
        Insert: {
          customer_id: string
          embedding: string
          enrolled_at?: string
          id?: string
          model_version?: string
          quality_score?: number | null
        }
        Update: {
          customer_id?: string
          embedding?: string
          enrolled_at?: string
          id?: string
          model_version?: string
          quality_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "face_embeddings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          celery_task_id: string | null
          created_at: string
          customer_id: string
          id: string
          scheduled_at: string
          status: string
          template_name: string
          template_vars: Json
          updated_at: string
        }
        Insert: {
          celery_task_id?: string | null
          created_at?: string
          customer_id: string
          id?: string
          scheduled_at: string
          status?: string
          template_name: string
          template_vars?: Json
          updated_at?: string
        }
        Update: {
          celery_task_id?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          scheduled_at?: string
          status?: string
          template_name?: string
          template_vars?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_generated: boolean
          approved_by: string | null
          category: string | null
          content: string
          created_at: string
          customer_id: string
          direction: string
          draft_status: string | null
          id: string
          received_at: string | null
          sender_salesperson_id: string | null
          sender_type: string
          sent_as_salesperson_id: string | null
          sent_at: string | null
          status: string
          template_name: string | null
          updated_at: string
          wamid: string | null
        }
        Insert: {
          ai_generated?: boolean
          approved_by?: string | null
          category?: string | null
          content: string
          created_at?: string
          customer_id: string
          direction: string
          draft_status?: string | null
          id?: string
          received_at?: string | null
          sender_salesperson_id?: string | null
          sender_type?: string
          sent_as_salesperson_id?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          wamid?: string | null
        }
        Update: {
          ai_generated?: boolean
          approved_by?: string | null
          category?: string | null
          content?: string
          created_at?: string
          customer_id?: string
          direction?: string
          draft_status?: string | null
          id?: string
          received_at?: string | null
          sender_salesperson_id?: string | null
          sender_type?: string
          sent_as_salesperson_id?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_salesperson_id_fkey"
            columns: ["sender_salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sent_as_salesperson_id_fkey"
            columns: ["sent_as_salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          closing_notes: string | null
          customer_id: string
          stage: Database["public"]["Enums"]["pipeline_stage"]
          updated_at: string
        }
        Insert: {
          closing_notes?: string | null
          customer_id: string
          stage?: Database["public"]["Enums"]["pipeline_stage"]
          updated_at?: string
        }
        Update: {
          closing_notes?: string | null
          customer_id?: string
          stage?: Database["public"]["Enums"]["pipeline_stage"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      orders: {
        Row: {
          advance_expected: number
          cgst: number
          created_at: string
          customer_id: string
          discount_amount: number
          expected_delivery_date: string | null
          grand_total: number
          id: string
          igst: number
          notes: string | null
          order_no: string
          quotation_id: string | null
          salesperson_id: string | null
          sgst: number
          status: string
          subtotal: number
          taxable_value: number
          updated_at: string
        }
        Insert: {
          advance_expected?: number
          cgst?: number
          created_at?: string
          customer_id: string
          discount_amount?: number
          expected_delivery_date?: string | null
          grand_total?: number
          id?: string
          igst?: number
          notes?: string | null
          order_no: string
          quotation_id?: string | null
          salesperson_id?: string | null
          sgst?: number
          status?: string
          subtotal?: number
          taxable_value?: number
          updated_at?: string
        }
        Update: {
          advance_expected?: number
          cgst?: number
          created_at?: string
          customer_id?: string
          discount_amount?: number
          expected_delivery_date?: string | null
          grand_total?: number
          id?: string
          igst?: number
          notes?: string | null
          order_no?: string
          quotation_id?: string | null
          salesperson_id?: string | null
          sgst?: number
          status?: string
          subtotal?: number
          taxable_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          blocked: boolean
          blocked_at: string | null
          current_stage: string | null
          current_stage_at: string | null
          customization: string | null
          description: string
          dimensions: string | null
          fabric: string | null
          gst_rate: number
          hsn: string
          id: string
          line_total: number
          material: string | null
          order_id: string
          polish: string | null
          product_id: string | null
          production_done_at: string | null
          transit_transfer_id: string | null
          qty: number
          sort: number
          spec_notes: string | null
          unit: string | null
          unit_price: number
          workshop_id: string | null
        }
        Insert: {
          blocked?: boolean
          blocked_at?: string | null
          current_stage?: string | null
          current_stage_at?: string | null
          customization?: string | null
          description: string
          dimensions?: string | null
          fabric?: string | null
          gst_rate: number
          hsn: string
          id?: string
          line_total: number
          material?: string | null
          order_id: string
          polish?: string | null
          product_id?: string | null
          production_done_at?: string | null
          transit_transfer_id?: string | null
          qty: number
          sort?: number
          spec_notes?: string | null
          unit?: string | null
          unit_price: number
          workshop_id?: string | null
        }
        Update: {
          blocked?: boolean
          blocked_at?: string | null
          current_stage?: string | null
          current_stage_at?: string | null
          customization?: string | null
          description?: string
          dimensions?: string | null
          fabric?: string | null
          gst_rate?: number
          hsn?: string
          id?: string
          line_total?: number
          material?: string | null
          order_id?: string
          polish?: string | null
          product_id?: string | null
          production_done_at?: string | null
          transit_transfer_id?: string | null
          qty?: number
          sort?: number
          spec_notes?: string | null
          unit?: string | null
          unit_price?: number
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_current_stage_fkey"
            columns: ["current_stage"]
            isOneToOne: false
            referencedRelation: "production_stage_defs"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "order_items_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          customer_id: string
          id: string
          kind: string
          mode: string
          notes: string | null
          order_id: string
          paid_at: string
          receipt_no: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id: string
          id?: string
          kind: string
          mode: string
          notes?: string | null
          order_id: string
          paid_at: string
          receipt_no: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string
          id?: string
          kind?: string
          mode?: string
          notes?: string | null
          order_id?: string
          paid_at?: string
          receipt_no?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_schedules: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          label: string | null
          order_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          label?: string | null
          order_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          label?: string | null
          order_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_schedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          base_price: number | null
          category: string | null
          created_at: string
          gst_rate: number
          hsn: string
          id: string
          name: string
          primary_media_id: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price?: number | null
          category?: string | null
          created_at?: string
          gst_rate?: number
          hsn?: string
          id?: string
          name: string
          primary_media_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price?: number | null
          category?: string | null
          created_at?: string
          gst_rate?: number
          hsn?: string
          id?: string
          name?: string
          primary_media_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_primary_media_id_fkey"
            columns: ["primary_media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          approval_token: string
          approved_at: string | null
          approved_ip: string | null
          cgst: number
          created_at: string
          created_by: string | null
          customer_id: string
          discount_amount: number
          grand_total: number
          id: string
          igst: number
          notes: string | null
          pdf_key: string | null
          place_of_supply: string
          quote_no: string
          revision_no: number
          revision_of: string | null
          sgst: number
          status: string
          subtotal: number
          taxable_value: number
          terms: string | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          approval_token?: string
          approved_at?: string | null
          approved_ip?: string | null
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          discount_amount?: number
          grand_total?: number
          id?: string
          igst?: number
          notes?: string | null
          pdf_key?: string | null
          place_of_supply?: string
          quote_no: string
          revision_no?: number
          revision_of?: string | null
          sgst?: number
          status?: string
          subtotal?: number
          taxable_value?: number
          terms?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          approval_token?: string
          approved_at?: string | null
          approved_ip?: string | null
          cgst?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          discount_amount?: number
          grand_total?: number
          id?: string
          igst?: number
          notes?: string | null
          pdf_key?: string | null
          place_of_supply?: string
          quote_no?: string
          revision_no?: number
          revision_of?: string | null
          sgst?: number
          status?: string
          subtotal?: number
          taxable_value?: number
          terms?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_revision_of_fkey"
            columns: ["revision_of"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_items: {
        Row: {
          customization: string | null
          description: string
          dimensions: string | null
          fabric: string | null
          gst_rate: number
          hsn: string
          id: string
          line_total: number
          material: string | null
          polish: string | null
          product_id: string | null
          qty: number
          quotation_id: string
          sort: number
          spec_notes: string | null
          unit: string | null
          unit_price: number
        }
        Insert: {
          customization?: string | null
          description: string
          dimensions?: string | null
          fabric?: string | null
          gst_rate: number
          hsn: string
          id?: string
          line_total: number
          material?: string | null
          polish?: string | null
          product_id?: string | null
          qty: number
          quotation_id: string
          sort?: number
          spec_notes?: string | null
          unit?: string | null
          unit_price: number
        }
        Update: {
          customization?: string | null
          description?: string
          dimensions?: string | null
          fabric?: string | null
          gst_rate?: number
          hsn?: string
          id?: string
          line_total?: number
          material?: string | null
          polish?: string | null
          product_id?: string | null
          qty?: number
          quotation_id?: string
          sort?: number
          spec_notes?: string | null
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      salespersons: {
        Row: {
          active: boolean
          auth_uid: string | null
          available: boolean
          created_at: string
          id: string
          name: string
          role: string
          whatsapp: string
        }
        Insert: {
          active?: boolean
          auth_uid?: string | null
          available?: boolean
          created_at?: string
          id?: string
          name: string
          role?: string
          whatsapp: string
        }
        Update: {
          active?: boolean
          auth_uid?: string | null
          available?: boolean
          created_at?: string
          id?: string
          name?: string
          role?: string
          whatsapp?: string
        }
        Relationships: []
      }
      visits: {
        Row: {
          customer_id: string | null
          id: string
          match_band: string
          match_score: number | null
          occurred_at: string
          photo_key: string | null
          raw_event_id: string
          salesperson_id: string | null
        }
        Insert: {
          customer_id?: string | null
          id?: string
          match_band: string
          match_score?: number | null
          occurred_at?: string
          photo_key?: string | null
          raw_event_id: string
          salesperson_id?: string | null
        }
        Update: {
          customer_id?: string | null
          id?: string
          match_band?: string
          match_score?: number | null
          occurred_at?: string
          photo_key?: string | null
          raw_event_id?: string
          salesperson_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      // ─── Module 14 (migrations 0029-0031) ────────────────────────────────
      // Hand-added to this generated file, same as every earlier phase (STATE.md
      // "types.ts extended"). Regenerating with `supabase gen types` will reproduce
      // them; the Relationships arrays are omitted deliberately — nothing in the app
      // relies on PostgREST relationship inference for these, every join is explicit.
      workshop_staff: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          id: string
          role: string
          salesperson_id: string
          updated_at: string
          workshop_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          id?: string
          role: string
          salesperson_id: string
          updated_at?: string
          workshop_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          id?: string
          role?: string
          salesperson_id?: string
          updated_at?: string
          workshop_id?: string
        }
        Relationships: []
      }
      order_item_route_legs: {
        Row: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          order_item_id: string
          planned_days: number | null
          seq: number
          stage_from: string
          stage_to: string
          status: string
          updated_at: string
          workshop_id: string
        }
        Insert: {
          activated_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          order_item_id: string
          planned_days?: number | null
          seq: number
          stage_from: string
          stage_to: string
          status?: string
          updated_at?: string
          workshop_id: string
        }
        Update: {
          activated_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          order_item_id?: string
          planned_days?: number | null
          seq?: number
          stage_from?: string
          stage_to?: string
          status?: string
          updated_at?: string
          workshop_id?: string
        }
        Relationships: []
      }
      production_route_templates: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      production_route_template_legs: {
        Row: {
          created_at: string
          id: string
          planned_days: number
          seq: number
          stage_from: string
          stage_to: string
          template_id: string
          workshop_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          planned_days: number
          seq: number
          stage_from: string
          stage_to: string
          template_id: string
          workshop_id: string
        }
        Update: {
          created_at?: string
          id?: string
          planned_days?: number
          seq?: number
          stage_from?: string
          stage_to?: string
          template_id?: string
          workshop_id?: string
        }
        Relationships: []
      }
      workshop_transfers: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          courier_salesperson_id: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          due_at: string | null
          expected_pickup_at: string | null
          from_workshop_id: string
          id: string
          notes: string | null
          picked_up_at: string | null
          reason: string
          received_at: string | null
          status: string
          to_workshop_id: string
          transfer_no: string
          updated_at: string
          vehicle_no: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          courier_salesperson_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          due_at?: string | null
          expected_pickup_at?: string | null
          from_workshop_id: string
          id?: string
          notes?: string | null
          picked_up_at?: string | null
          reason?: string
          received_at?: string | null
          status?: string
          to_workshop_id: string
          transfer_no: string
          updated_at?: string
          vehicle_no?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          courier_salesperson_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          due_at?: string | null
          expected_pickup_at?: string | null
          from_workshop_id?: string
          id?: string
          notes?: string | null
          picked_up_at?: string | null
          reason?: string
          received_at?: string | null
          status?: string
          to_workshop_id?: string
          transfer_no?: string
          updated_at?: string
          vehicle_no?: string | null
        }
        Relationships: []
      }
      workshop_transfer_items: {
        Row: {
          created_at: string
          id: string
          open: boolean
          order_item_id: string
          qty: number | null
          route_leg_id: string | null
          transfer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          open?: boolean
          order_item_id: string
          qty?: number | null
          route_leg_id?: string | null
          transfer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          open?: boolean
          order_item_id?: string
          qty?: number | null
          route_leg_id?: string | null
          transfer_id?: string
        }
        Relationships: []
      }
      workshop_transfer_events: {
        Row: {
          actor: string | null
          at: string
          id: string
          kind: string
          media_id: string | null
          note: string | null
          transfer_id: string
        }
        Insert: {
          actor?: string | null
          at?: string
          id?: string
          kind: string
          media_id?: string | null
          note?: string | null
          transfer_id: string
        }
        Update: {
          actor?: string | null
          at?: string
          id?: string
          kind?: string
          media_id?: string | null
          note?: string | null
          transfer_id?: string
        }
        Relationships: []
      }
      workshops: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          id: string
          manager_name: string | null
          manager_phone: string | null
          manager_salesperson_id: string | null
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          manager_name?: string | null
          manager_phone?: string | null
          manager_salesperson_id?: string | null
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          manager_name?: string | null
          manager_phone?: string | null
          manager_salesperson_id?: string | null
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshops_manager_salesperson_id_fkey"
            columns: ["manager_salesperson_id"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      production_stage_defs: {
        Row: {
          active: boolean
          code: string
          label_en: string
          label_gu: string | null
          photo_required: boolean
          sort: number
        }
        Insert: {
          active?: boolean
          code: string
          label_en: string
          label_gu?: string | null
          photo_required?: boolean
          sort: number
        }
        Update: {
          active?: boolean
          code?: string
          label_en?: string
          label_gu?: string | null
          photo_required?: boolean
          sort?: number
        }
        Relationships: []
      }
      order_item_assignments: {
        Row: {
          active: boolean
          assigned_by: string | null
          created_at: string
          deactivated_at: string | null
          due_at: string | null
          due_date: string | null
          id: string
          order_item_id: string
          route_leg_id: string | null
          workshop_id: string
        }
        Insert: {
          active?: boolean
          assigned_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          due_at?: string | null
          due_date?: string | null
          id?: string
          order_item_id: string
          route_leg_id?: string | null
          workshop_id: string
        }
        Update: {
          active?: boolean
          assigned_by?: string | null
          created_at?: string
          deactivated_at?: string | null
          due_at?: string | null
          due_date?: string | null
          id?: string
          order_item_id?: string
          route_leg_id?: string | null
          workshop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_assignments_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_assignments_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
        ]
      }
      production_events: {
        Row: {
          actor: string | null
          at: string
          id: string
          kind: string
          media_id: string | null
          note: string | null
          order_item_id: string
          stage_code: string
        }
        Insert: {
          actor?: string | null
          at?: string
          id?: string
          kind: string
          media_id?: string | null
          note?: string | null
          order_item_id: string
          stage_code: string
        }
        Update: {
          actor?: string | null
          at?: string
          id?: string
          kind?: string
          media_id?: string | null
          note?: string | null
          order_item_id?: string
          stage_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_events_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_events_stage_code_fkey"
            columns: ["stage_code"]
            isOneToOne: false
            referencedRelation: "production_stage_defs"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "production_events_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          bytes: number | null
          created_at: string
          created_by: string | null
          entity_id: string
          entity_type: string
          id: string
          kind: string
          mime: string
          stage_code: string | null
          status: string
          storage_key: string
          thumb_key: string | null
          uploaded_at: string | null
        }
        Insert: {
          bytes?: number | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          kind: string
          mime: string
          stage_code?: string | null
          status?: string
          storage_key: string
          thumb_key?: string | null
          uploaded_at?: string | null
        }
        Update: {
          bytes?: number | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          kind?: string
          mime?: string
          stage_code?: string | null
          status?: string
          storage_key?: string
          thumb_key?: string | null
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "salespersons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_stage_code_fkey"
            columns: ["stage_code"]
            isOneToOne: false
            referencedRelation: "production_stage_defs"
            referencedColumns: ["code"]
          },
        ]
      }
      deliveries: {
        Row: {
          id: string
          order_id: string
          driver_salesperson_id: string | null
          status: string
          scheduled_date: string
          delivered_at: string | null
          vehicle_no: string | null
          eway_bill_no: string | null
          notes: string | null
          challan_no: string | null
          delivery_address: string | null
          delivery_rent: number | null
          dp_code: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          driver_salesperson_id?: string | null
          status?: string
          scheduled_date?: string
          delivered_at?: string | null
          vehicle_no?: string | null
          eway_bill_no?: string | null
          notes?: string | null
          challan_no?: string | null
          delivery_address?: string | null
          delivery_rent?: number | null
          dp_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          driver_salesperson_id?: string | null
          status?: string
          scheduled_date?: string
          delivered_at?: string | null
          vehicle_no?: string | null
          eway_bill_no?: string | null
          notes?: string | null
          challan_no?: string | null
          delivery_address?: string | null
          delivery_rent?: number | null
          dp_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      delivery_items: {
        Row: {
          id: string
          delivery_id: string
          order_item_id: string
          /** Denorm of deliveries.status, maintained by trigger (0039). */
          delivery_status: string | null
          created_at: string
        }
        Insert: {
          id?: string
          delivery_id: string
          order_item_id?: string
          delivery_status?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          delivery_id?: string
          order_item_id?: string
          delivery_status?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_items_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      order_outstanding: {
        Row: {
          grand_total: number | null
          order_id: string | null
          outstanding: number | null
          paid: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_pkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_customer: { Args: { p_customer_id: string }; Returns: boolean }
      current_salesperson_id: { Args: never; Returns: string }
      is_assigned_to_customer: {
        Args: { p_customer_id: string }
        Returns: boolean
      }
      is_owner: { Args: never; Returns: boolean }
      /**
       * Creates a delivery and its item lines in ONE transaction (0039).
       * SECURITY INVOKER — the caller's own RLS still authorizes the write.
       * Returns the new delivery's id.
       */
      schedule_delivery: {
        Args: {
          p_order_id: string
          p_scheduled_date: string
          p_driver: string | null
          p_item_ids: string[]
          p_vehicle_no?: string | null
          p_eway_bill_no?: string | null
          p_notes?: string | null
          p_delivery_address?: string | null
          p_delivery_rent?: number | null
          p_dp_code?: string | null
        }
        Returns: string
      }
    }
    Enums: {
      assignment_role: "primary" | "collaborator"
      coverage_status: "open" | "claimed" | "closed"
      pipeline_stage:
        | "new"
        | "talking"
        | "follow_up"
        | "won"
        | "lost"
        | "inquiry"
        | "contacted"
        | "visit_scheduled"
        | "walk_in"
        | "design_discussion"
        | "quotation_sent"
        | "negotiation"
        | "order_confirmed"
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
    Enums: {
      assignment_role: ["primary", "collaborator"],
      coverage_status: ["open", "claimed", "closed"],
      pipeline_stage: [
        "new",
        "talking",
        "follow_up",
        "won",
        "lost",
        "inquiry",
        "contacted",
        "visit_scheduled",
        "walk_in",
        "design_discussion",
        "quotation_sent",
        "negotiation",
        "order_confirmed",
      ],
    },
  },
} as const

