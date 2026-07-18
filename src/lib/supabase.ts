import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { setSharedSupabase } from './supabaseShared';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Shared holder so browser/worker-agnostic modules (linkgen, marketData…)
// reach this same client without importing import.meta.env code.
setSharedSupabase(supabase);
