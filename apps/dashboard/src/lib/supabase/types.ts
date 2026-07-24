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
          salesperson_id?: string | null
          seen_at?: string | null
          type?: string
        }
        Relationships: []
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
          qty: number
          sort: number
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
          order_id: string
          polish?: string | null
          product_id?: string | null
          qty: number
          sort?: number
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
          order_id?: string
          polish?: string | null
          product_id?: string | null
          qty?: number
          sort?: number
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
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

