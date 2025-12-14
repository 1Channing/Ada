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
