import { useCallback, useEffect, useState } from 'react';
import { adminSupabase } from './client';

export type BusinessSession = {
  userId: string;
  email: string;
  brandId: string;
  businessName: string;
  role: 'owner' | 'staff';
};

type SessionState = {
  loading: boolean;
  session: BusinessSession | null;
  error: string;
};

export function useBusinessSession() {
  const [state, setState] = useState<SessionState>({
    loading: true,
    session: null,
    error: '',
  });

  const refresh = useCallback(async () => {
    if (!adminSupabase) {
      setState({ loading: false, session: null, error: '' });
      return;
    }

    try {
      const { data: userResult, error: authError } = await adminSupabase.auth.getUser();
      if (authError || !userResult.user) {
        setState({ loading: false, session: null, error: '' });
        return;
      }

      // Never use user_metadata or the business ID supplied by the browser
      // for authorization. The membership is read under database RLS.
      const { data: membership, error: membershipError } = await adminSupabase
        .from('admin_users')
        .select('brand_id, role')
        .eq('supabase_user_id', userResult.user.id)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        setState({
          loading: false,
          session: null,
          error: 'This account has not been invited to a BeanBook business.',
        });
        return;
      }

      const { data: business, error: brandError } = await adminSupabase
        .from('brands')
        .select('id, name')
        .eq('id', membership.brand_id)
        .single();

      if (brandError) throw brandError;

      setState({
        loading: false,
        error: '',
        session: {
          userId: userResult.user.id,
          email: userResult.user.email || '',
          brandId: business.id,
          businessName: business.name,
          role: membership.role === 'owner' ? 'owner' : 'staff',
        },
      });
    } catch (error) {
      setState({
        loading: false,
        session: null,
        error: error instanceof Error ? error.message : 'Unable to load your workspace.',
      });
    }
  }, []);

  useEffect(() => {
    if (!adminSupabase) {
      void refresh();
      return;
    }
    void refresh();
    const { data: listener } = adminSupabase.auth.onAuthStateChange(() => {
      // Avoid calling Supabase client methods synchronously in the auth callback.
      window.setTimeout(() => void refresh(), 0);
    });
    return () => listener.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async () => {
    if (!adminSupabase) return;
    await adminSupabase.auth.signOut();
    setState({ loading: false, session: null, error: '' });
  }, []);

  const updateBusinessName = useCallback(async (name: string) => {
    if (!adminSupabase || !state.session || state.session.role !== 'owner') {
      throw new Error('Only business owners can change the business name.');
    }
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      throw new Error('Business name must be between 2 and 120 characters.');
    }

    const { data, error } = await adminSupabase
      .from('brands')
      .update({ name: trimmed })
      .eq('id', state.session.brandId)
      .select('name')
      .single();

    if (error) throw error;
    setState((current) => current.session
      ? { ...current, session: { ...current.session, businessName: data.name } }
      : current);
  }, [state.session]);

  return { ...state, refresh, signOut, updateBusinessName };
}
