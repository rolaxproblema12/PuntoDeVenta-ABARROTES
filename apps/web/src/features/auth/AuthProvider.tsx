import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Profile, Tenant } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';

interface AuthCtx {
  loading: boolean;
  session: boolean;
  profile: Profile | null;
  tenant: Tenant | null;
  isPlatformAdmin: boolean;
}

const Ctx = createContext<AuthCtx>({
  loading: true,
  session: false,
  profile: null,
  tenant: null,
  isPlatformAdmin: false,
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthCtx>({
    loading: true,
    session: false,
    profile: null,
    tenant: null,
    isPlatformAdmin: false,
  });

  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setState({
          loading: false,
          session: false,
          profile: null,
          tenant: null,
          isPlatformAdmin: false,
        });
        return;
      }
      const uid = data.session.user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'id, full_name, email, role, active, default_sucursal_id, tenant_id',
        )
        .eq('id', uid)
        .maybeSingle();

      // Sesión válida pero sin perfil utilizable → trátalo como no-autenticado
      // para no exponer rutas protegidas con profile:null.
      if (!profile) {
        setState({
          loading: false,
          session: false,
          profile: null,
          tenant: null,
          isPlatformAdmin: false,
        });
        return;
      }

      const [{ data: padmin }, tenantRes] = await Promise.all([
        supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', uid)
          .maybeSingle(),
        profile.tenant_id
          ? supabase
              .from('tenants')
              .select('id, name, slug, status, plan_code, trial_ends_at, owner_user_id, created_at')
              .eq('id', profile.tenant_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      setState({
        loading: false,
        session: true,
        profile: profile as Profile,
        tenant: (tenantRes.data as Tenant) ?? null,
        isPlatformAdmin: !!padmin,
      });
    }
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void load());
    return () => sub.subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
