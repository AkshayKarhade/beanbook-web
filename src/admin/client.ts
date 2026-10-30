import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// This deployment uses the existing shared Supabase project.
// Row-level security and server-side membership enforcement are mandatory.
const url = import.meta.env.VITE_BEANBOOK_ADMIN_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_BEANBOOK_ADMIN_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const adminBackendConfigured = Boolean(url && key);

export const adminSupabase: SupabaseClient | null = adminBackendConfigured
  ? createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;
