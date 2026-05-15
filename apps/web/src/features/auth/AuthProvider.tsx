import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Profile } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';

interface AuthCtx {
  loading: boolean;
  session: boolean;
  profile: Profile | null;
}

const Ctx = createContext<AuthCtx>({
  loading: true,
  session: false,
  profile: null,
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthCtx>({
    loading: true,
    session: false,
    profile: null,
  });

  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setState({ loading: false, session: false, profile: null });
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, active, default_sucursal_id')
        .eq('id', data.session.user.id)
        .single();
      setState({
        loading: false,
        session: true,
        profile: (profile as Profile) ?? null,
      });
    }
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void load());
    return () => sub.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
