import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Step 1 intentionally uses an explicit, separately configured Supabase project.
// Never silently fall back to the live store/checkout database.
const url = import.meta.env.VITE_BEANBOOK_ADMIN_SUPABASE_URL;
const key = import.meta.env.VITE_BEANBOOK_ADMIN_SUPABASE_PUBLISHABLE_KEY;

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
