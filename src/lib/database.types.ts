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
      market_studies: {
        Row: {
          id: string
          name: string
          brand: string
          model_pattern: string
          year_min: number | null
          year_max: number | null
          mileage_min: number | null
          mileage_max: number | null
          source_country: string
          source_marketplace: string
          source_search_url: string
          target_country: string
          target_marketplace: string
          target_search_url: string | null
          pricing_strategy: string
          last_computed_target_export_price_eur: number | null
          last_computed_target_export_price_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          brand: string
          model_pattern: string
          year_min?: number | null
          year_max?: number | null
          mileage_min?: number | null
          mileage_max?: number | null
          source_country: string
          source_marketplace: string
          source_search_url: string
          target_country: string
          target_marketplace: string
          target_search_url?: string | null
          pricing_strategy?: string
          last_computed_target_export_price_eur?: number | null
          last_computed_target_export_price_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          brand?: string
          model_pattern?: string
          year_min?: number | null
          year_max?: number | null
          mileage_min?: number | null
          mileage_max?: number | null
          source_country?: string
          source_marketplace?: string
          source_search_url?: string
          target_country?: string
          target_marketplace?: string
          target_search_url?: string | null
          pricing_strategy?: string
          last_computed_target_export_price_eur?: number | null
          last_computed_target_export_price_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      search_queries: {
        Row: {
          id: string
          date_recherche: string
          source_country: string
          target_country: string
          source_marketplace: string
          source_search_url: string
          modele: string
          type_recherche: 'etude' | 'manuel' | 'test' | 'veille'
          commentaire: string | null
          created_at: string
        }
        Insert: {
          id?: string
          date_recherche: string
          source_country: string
          target_country: string
          source_marketplace: string
          source_search_url: string
          modele: string
          type_recherche: 'etude' | 'manuel' | 'test' | 'veille'
          commentaire?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          date_recherche?: string
          source_country?: string
          target_country?: string
          source_marketplace?: string
          source_search_url?: string
          modele?: string
          type_recherche?: 'etude' | 'manuel' | 'test' | 'veille'
          commentaire?: string | null
          created_at?: string
        }
        Relationships: []
      }
      listings: {
        Row: {
          id: string
          market_study_id: string | null
          search_query_id: string | null
          source_site: string
          source_country: string
          target_country: string
          url_annonce: string
          brand: string
          model: string
          year: number | null
          km: number | null
          price_eur: number
          target_export_price_eur: number | null
          estimated_margin_eur: number | null
          score_mc: number | null
          status: 'new' | 'seen' | 'disappeared' | 'price_up' | 'price_down' | 'contacted' | 'bought' | 'rejected'
          deal_status: string | null
          first_seen_at: string
          last_seen_at: string
          price_original: number
          price_current: number
          price_variation_eur: number | null
          days_online: number | null
          details_scraped: boolean
          is_running: boolean | null
          is_accident_suspected: boolean | null
          risk_level: 'low' | 'medium' | 'high' | null
          risk_flags: string | null
          ai_comment: string | null
          ai_detail_comment: string | null
          photos_urls: Json | null
          raw_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          market_study_id?: string | null
          search_query_id?: string | null
          source_site: string
          source_country: string
          target_country: string
          url_annonce: string
          brand: string
          model: string
          year?: number | null
          km?: number | null
          price_eur: number
          target_export_price_eur?: number | null
          estimated_margin_eur?: number | null
          score_mc?: number | null
          status?: 'new' | 'seen' | 'disappeared' | 'price_up' | 'price_down' | 'contacted' | 'bought' | 'rejected'
          deal_status?: string | null
          first_seen_at: string
          last_seen_at: string
          price_original: number
          price_current: number
          price_variation_eur?: number | null
          days_online?: number | null
          details_scraped?: boolean
          is_running?: boolean | null
          is_accident_suspected?: boolean | null
          risk_level?: 'low' | 'medium' | 'high' | null
          risk_flags?: string | null
          ai_comment?: string | null
          ai_detail_comment?: string | null
          photos_urls?: Json | null
          raw_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          market_study_id?: string | null
          search_query_id?: string | null
          source_site?: string
          source_country?: string
          target_country?: string
          url_annonce?: string
          brand?: string
          model?: string
          year?: number | null
          km?: number | null
          price_eur?: number
          target_export_price_eur?: number | null
          estimated_margin_eur?: number | null
          score_mc?: number | null
          status?: 'new' | 'seen' | 'disappeared' | 'price_up' | 'price_down' | 'contacted' | 'bought' | 'rejected'
          deal_status?: string | null
          first_seen_at?: string
          last_seen_at?: string
          price_original?: number
          price_current?: number
          price_variation_eur?: number | null
          days_online?: number | null
          details_scraped?: boolean
          is_running?: boolean | null
          is_accident_suspected?: boolean | null
          risk_level?: 'low' | 'medium' | 'high' | null
          risk_flags?: string | null
          ai_comment?: string | null
          ai_detail_comment?: string | null
          photos_urls?: Json | null
          raw_data?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          id: string
          run_type: string
          started_at: string
          finished_at: string | null
          status: 'running' | 'success' | 'error'
          message: string | null
          details: Json | null
        }
        Insert: {
          id?: string
          run_type: string
          started_at: string
          finished_at?: string | null
          status: 'running' | 'success' | 'error'
          message?: string | null
          details?: Json | null
        }
        Update: {
          id?: string
          run_type?: string
          started_at?: string
          finished_at?: string | null
          status?: 'running' | 'success' | 'error'
          message?: string | null
          details?: Json | null
        }
        Relationships: []
      }
      linkgen_mapping_memory: {
        Row: {
          id: string
          site: string
          country: string
          brand: string
          model: string
          fuel: string
          trim: string
          source_url: string | null
          detected_params: Json | null
          inferred_mapping: Json | null
          validated_mapping: Json | null
          confidence: number
          validation_status: string
          issues: Json | null
          success_count: number
          failure_count: number
          created_at: string
          updated_at: string
          last_checked_at: string | null
          validated_url: string | null
          scout_score: number
          tested_hypotheses: Json | null
          source: string
          human_confirmations: number
          last_confirmed_at: string | null
        }
        Insert: {
          id?: string
          site: string
          country?: string
          brand?: string
          model?: string
          fuel?: string
          trim?: string
          source_url?: string | null
          detected_params?: Json | null
          inferred_mapping?: Json | null
          validated_mapping?: Json | null
          confidence?: number
          validation_status?: string
          issues?: Json | null
          success_count?: number
          failure_count?: number
          created_at?: string
          updated_at?: string
          last_checked_at?: string | null
          validated_url?: string | null
          scout_score?: number
          tested_hypotheses?: Json | null
          source?: string
          human_confirmations?: number
          last_confirmed_at?: string | null
        }
        Update: {
          id?: string
          site?: string
          country?: string
          brand?: string
          model?: string
          fuel?: string
          trim?: string
          source_url?: string | null
          detected_params?: Json | null
          inferred_mapping?: Json | null
          validated_mapping?: Json | null
          confidence?: number
          validation_status?: string
          issues?: Json | null
          success_count?: number
          failure_count?: number
          created_at?: string
          updated_at?: string
          last_checked_at?: string | null
          validated_url?: string | null
          scout_score?: number
          tested_hypotheses?: Json | null
          source?: string
          human_confirmations?: number
          last_confirmed_at?: string | null
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          id: string
          site: string
          country: string
          brand: string
          model: string
          fuel: string
          trim: string
          scraped_at: string
          listing_count: number | null
          sample_size: number
          price_min: number | null
          price_p25: number | null
          price_median: number | null
          price_p75: number | null
          price_max: number | null
          price_avg: number | null
          currency: string
          source_url: string | null
          submitted_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          site: string
          country?: string
          brand?: string
          model?: string
          fuel?: string
          trim?: string
          scraped_at?: string
          listing_count?: number | null
          sample_size?: number
          price_min?: number | null
          price_p25?: number | null
          price_median?: number | null
          price_p75?: number | null
          price_max?: number | null
          price_avg?: number | null
          currency?: string
          source_url?: string | null
          submitted_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          site?: string
          country?: string
          brand?: string
          model?: string
          fuel?: string
          trim?: string
          scraped_at?: string
          listing_count?: number | null
          sample_size?: number
          price_min?: number | null
          price_p25?: number | null
          price_median?: number | null
          price_p75?: number | null
          price_max?: number | null
          price_avg?: number | null
          currency?: string
          source_url?: string | null
          submitted_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      market_listing_observations: {
        Row: {
          id: string
          snapshot_id: string
          site: string
          country: string
          brand: string
          model: string
          fuel: string
          trim: string
          internal_ref: string
          price: number | null
          year: number | null
          mileage: number | null
          power_din: number | null
          listing_url: string | null
          title: string | null
          currency: string
          scraped_at: string
          created_at: string
        }
        Insert: {
          id?: string
          snapshot_id: string
          site: string
          country?: string
          brand?: string
          model?: string
          fuel?: string
          trim?: string
          internal_ref: string
          price?: number | null
          year?: number | null
          mileage?: number | null
          power_din?: number | null
          listing_url?: string | null
          title?: string | null
          currency?: string
          scraped_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          snapshot_id?: string
          site?: string
          country?: string
          brand?: string
          model?: string
          fuel?: string
          trim?: string
          internal_ref?: string
          price?: number | null
          year?: number | null
          mileage?: number | null
          power_din?: number | null
          listing_url?: string | null
          title?: string | null
          currency?: string
          scraped_at?: string
          created_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          id: string
          created_at: string
          type: string | null
          company_name: string | null
          first_name: string | null
          last_name: string | null
          birth_date: string | null
          birth_place: string | null
          siren: string | null
          address_line1: string | null
          address_line2: string | null
          postal_code: string | null
          city: string | null
          country: string | null
          phone: string | null
          email: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          type?: string | null
          company_name?: string | null
          first_name?: string | null
          last_name?: string | null
          birth_date?: string | null
          birth_place?: string | null
          siren?: string | null
          address_line1?: string | null
          address_line2?: string | null
          postal_code?: string | null
          city?: string | null
          country?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          type?: string | null
          company_name?: string | null
          first_name?: string | null
          last_name?: string | null
          birth_date?: string | null
          birth_place?: string | null
          siren?: string | null
          address_line1?: string | null
          address_line2?: string | null
          postal_code?: string | null
          city?: string | null
          country?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      vehicles_admin: {
        Row: {
          id: string
          created_at: string
          plate_number: string | null
          vin: string | null
          brand: string | null
          model: string | null
          commercial_name: string | null
          type_variant_version: string | null
          national_type: string | null
          first_registration_date: string | null
          mileage: number | null
          registration_certificate_present: boolean | null
          registration_certificate_number: string | null
          known_defects: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          plate_number?: string | null
          vin?: string | null
          brand?: string | null
          model?: string | null
          commercial_name?: string | null
          type_variant_version?: string | null
          national_type?: string | null
          first_registration_date?: string | null
          mileage?: number | null
          registration_certificate_present?: boolean | null
          registration_certificate_number?: string | null
          known_defects?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          plate_number?: string | null
          vin?: string | null
          brand?: string | null
          model?: string | null
          commercial_name?: string | null
          type_variant_version?: string | null
          national_type?: string | null
          first_registration_date?: string | null
          mileage?: number | null
          registration_certificate_present?: boolean | null
          registration_certificate_number?: string | null
          known_defects?: string | null
        }
        Relationships: []
      }
      transactions_admin: {
        Row: {
          id: string
          created_at: string
          transaction_type: string | null
          vehicle_id: string | null
          seller_contact_id: string | null
          seller_contact_id_2: string | null
          buyer_contact_id: string | null
          buyer_contact_id_2: string | null
          transaction_price: number | null
          transaction_date: string | null
          transaction_time: string | null
          pickup_location: string | null
          pickup_contact: string | null
          pickup_datetime: string | null
          destination: string | null
          transporter: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          transaction_type?: string | null
          vehicle_id?: string | null
          seller_contact_id?: string | null
          seller_contact_id_2?: string | null
          buyer_contact_id?: string | null
          buyer_contact_id_2?: string | null
          transaction_price?: number | null
          transaction_date?: string | null
          transaction_time?: string | null
          pickup_location?: string | null
          pickup_contact?: string | null
          pickup_datetime?: string | null
          destination?: string | null
          transporter?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          transaction_type?: string | null
          vehicle_id?: string | null
          seller_contact_id?: string | null
          seller_contact_id_2?: string | null
          buyer_contact_id?: string | null
          buyer_contact_id_2?: string | null
          transaction_price?: number | null
          transaction_date?: string | null
          transaction_time?: string | null
          pickup_location?: string | null
          pickup_contact?: string | null
          pickup_datetime?: string | null
          destination?: string | null
          transporter?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_admin_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_admin_seller_contact_id_fkey"
            columns: ["seller_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_admin_seller_contact_id_2_fkey"
            columns: ["seller_contact_id_2"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_admin_buyer_contact_id_fkey"
            columns: ["buyer_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_admin_buyer_contact_id_2_fkey"
            columns: ["buyer_contact_id_2"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      documents_admin_history: {
        Row: {
          id: string
          created_at: string
          transaction_id: string | null
          document_type: string | null
          pdf_url: string | null
          storage_path: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          transaction_id?: string | null
          document_type?: string | null
          pdf_url?: string | null
          storage_path?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          transaction_id?: string | null
          document_type?: string | null
          pdf_url?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_admin_history_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions_admin"
            referencedColumns: ["id"]
          },
        ]
      }
      market_opportunity_acks: {
        Row: {
          id: string
          brand: string
          model: string
          fuel: string
          low_country: string
          high_country: string
          delta_eur: number
          acked_by: string
          acked_at: string
          created_at: string
        }
        Insert: {
          id?: string
          brand: string
          model: string
          fuel?: string
          low_country: string
          high_country: string
          delta_eur: number
          acked_by?: string
          acked_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          brand?: string
          model?: string
          fuel?: string
          low_country?: string
          high_country?: string
          delta_eur?: number
          acked_by?: string
          acked_at?: string
          created_at?: string
        }
        Relationships: []
      }
      studies_v2: {
        Row: {
          id: string
          brand: string
          model: string
          year: number | null
          max_mileage: number | null
          country_target: string
          market_target_url: string
          country_source: string
          market_source_url: string
        }
        Insert: {
          id: string
          brand: string
          model: string
          year?: number | null
          max_mileage?: number | null
          country_target: string
          market_target_url: string
          country_source: string
          market_source_url: string
        }
        Update: {
          id?: string
          brand?: string
          model?: string
          year?: number | null
          max_mileage?: number | null
          country_target?: string
          market_target_url?: string
          country_source?: string
          market_source_url?: string
        }
        Relationships: []
      }
      linkgen_campaigns: {
        Row: {
          id: string
          label: string
          status: string
          total: number
          done_count: number
          confirmed_count: number
          gap_count: number
          technical_count: number
          config: Json | null
          created_at: string
          finished_at: string | null
          last_heartbeat: string | null
        }
        Insert: {
          id?: string
          label?: string
          status?: string
          total?: number
          done_count?: number
          confirmed_count?: number
          gap_count?: number
          technical_count?: number
          config?: Json | null
          created_at?: string
          finished_at?: string | null
          last_heartbeat?: string | null
        }
        Update: {
          id?: string
          label?: string
          status?: string
          total?: number
          done_count?: number
          confirmed_count?: number
          gap_count?: number
          technical_count?: number
          config?: Json | null
          created_at?: string
          finished_at?: string | null
          last_heartbeat?: string | null
        }
        Relationships: []
      }
      linkgen_campaign_items: {
        Row: {
          id: string
          campaign_id: string
          seq: number
          site: string
          brand: string
          model: string
          criteria: Json | null
          url: string | null
          kind: string
          outcome: string | null
          confirmed_fields: string[] | null
          rejected: Json | null
          detail: string | null
          sample_size: number
          created_at: string
          finished_at: string | null
          resolved_at: string | null
        }
        Insert: {
          id?: string
          campaign_id: string
          seq: number
          site: string
          brand: string
          model: string
          criteria?: Json | null
          url?: string | null
          kind?: string
          outcome?: string | null
          confirmed_fields?: string[] | null
          rejected?: Json | null
          detail?: string | null
          sample_size?: number
          created_at?: string
          finished_at?: string | null
          resolved_at?: string | null
        }
        Update: {
          id?: string
          campaign_id?: string
          seq?: number
          site?: string
          brand?: string
          model?: string
          criteria?: Json | null
          url?: string | null
          kind?: string
          outcome?: string | null
          confirmed_fields?: string[] | null
          rejected?: Json | null
          detail?: string | null
          sample_size?: number
          created_at?: string
          finished_at?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      linkgen_enum_mappings: {
        Row: {
          id: string
          site: string
          field: string
          code: string
          label: string
          confirmations: number
          created_at: string
          updated_at: string
          last_confirmed_at: string
        }
        Insert: {
          id?: string
          site: string
          field: string
          code: string
          label: string
          confirmations?: number
          created_at?: string
          updated_at?: string
          last_confirmed_at?: string
        }
        Update: {
          id?: string
          site?: string
          field?: string
          code?: string
          label?: string
          confirmations?: number
          created_at?: string
          updated_at?: string
          last_confirmed_at?: string
        }
        Relationships: []
      }
      linkgen_ingestion_events: {
        Row: {
          id: string
          created_at: string
          submitted_url: string
          site: string
          declared_criteria: Json | null
          detected_params: Json | null
          sample_size: number
          scrape_error: string | null
          retained: Json | null
          discarded: Json | null
          conflicts: Json | null
          memory_record_id: string | null
          memory_action: string | null
          submitted_by: string | null
          scrape_diagnostics: Json | null
        }
        Insert: {
          id?: string
          created_at?: string
          submitted_url: string
          site: string
          declared_criteria?: Json | null
          detected_params?: Json | null
          sample_size?: number
          scrape_error?: string | null
          retained?: Json | null
          discarded?: Json | null
          conflicts?: Json | null
          memory_record_id?: string | null
          memory_action?: string | null
          submitted_by?: string | null
          scrape_diagnostics?: Json | null
        }
        Update: {
          id?: string
          created_at?: string
          submitted_url?: string
          site?: string
          declared_criteria?: Json | null
          detected_params?: Json | null
          sample_size?: number
          scrape_error?: string | null
          retained?: Json | null
          discarded?: Json | null
          conflicts?: Json | null
          memory_record_id?: string | null
          memory_action?: string | null
          submitted_by?: string | null
          scrape_diagnostics?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
