import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beanbookPublicSupabaseKey } from './publicConfig';

// Existing shared Supabase project. All business access must be authorized with RLS.
const url = import.meta.env.VITE_BEANBOOK_ADMIN_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_BEANBOOK_ADMIN_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || beanbookPublicSupabaseKey;
export const adminBackendConfigured = Boolean(url && key);
export const adminSupabase: SupabaseClient | null = adminBackendConfigured
  ? createClient(url, key, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } })
  : null;
