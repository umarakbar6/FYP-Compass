import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { validatedCaptchaToken } from './captcha';
import { backendError, demoEnabled, supabase } from '../lib/supabase';
import { isRole, type PortalUser, type Role } from '../types/shared';

const demoKey = 'fyp-compass.demo-role';
const demoNames: Record<Role, string> = {
  student: 'Ayesha Khan',
  supervisor: 'Dr. Ahmed Ali',
  examiner: 'Dr. Sara Malik',
  coordinator: 'Dr. Hassan Raza',
};
function demoUser(role: Role): PortalUser {
  return {
    id: `demo-${role}`,
    full_name: demoNames[role],
    role,
    email: `${role}@demo.fypcompass.local`,
  };
}
interface AuthValue {
  user: PortalUser | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<void>;
  enterDemo: (role: Role) => void;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(backendError);
  const revision = useRef(0);
  const resolveUser = useCallback(async (id: string, email: string): Promise<PortalUser> => {
    if (!supabase) throw new Error('Supabase is not configured.');
    // Partner contract: profiles.id = auth.users.id; role is protected by RLS.
    const { data, error: profileError } = await supabase
      .from('fyp_profiles')
      .select('id, full_name, role')
      .eq('id', id)
      .single();
    if (profileError?.code === '42501' || profileError?.code === 'PGRST301')
      throw new Error('Your session ended. Sign in again to continue.');
    if (profileError || !data || !isRole(data.role))
      throw new Error(
        'Your account has no accessible role profile. Ask the coordinator to check your account.',
      );
    return { id: data.id, full_name: data.full_name || email, role: data.role, email };
  }, []);
  useEffect(() => {
    let active = true;
    if (!supabase) {
      if (demoEnabled) {
        try {
          const stored = sessionStorage.getItem(demoKey);
          if (isRole(stored)) setUser(demoUser(stored));
        } catch {
          /* Session storage may be unavailable; demo still works in memory. */
        }
      }
      setLoading(false);
      return;
    }
    const sync = async (session: { user: { id: string; email?: string } } | null) => {
      const request = ++revision.current;
      setLoading(true);
      // Never expose a previous user's screen while resolving the new profile.
      setUser(null);
      try {
        const profile = session
          ? await resolveUser(session.user.id, session.user.email || '')
          : null;
        if (active && request === revision.current) {
          setUser(profile);
          setError(null);
        }
      } catch (cause) {
        if (active && request === revision.current) {
          setUser(null);
          setError(cause instanceof Error ? cause.message : 'Unable to load your account.');
        }
      } finally {
        if (active && request === revision.current) setLoading(false);
      }
    };
    // Avoid awaiting Supabase calls inside its auth callback.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        if (window.location.pathname !== '/auth/reset')
          window.location.replace('/auth/reset' + window.location.hash);
        return;
      }
      queueMicrotask(() => {
        if (active) void sync(session);
      });
    });
    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError) {
          setError('Unable to restore your session. Please sign in again.');
          setLoading(false);
        } else if (revision.current === 0) void sync(data.session);
      })
      .catch(() => {
        if (active) {
          setError('Unable to connect to authentication. Please try again.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
      revision.current++;
      subscription.unsubscribe();
    };
  }, [resolveUser]);
  async function signIn(email: string, password: string, captchaToken?: string) {
    if (!supabase)
      throw new Error(
        backendError ||
          "Real sign in requires the project's Supabase configuration. Use a local demo below.",
      );
    setError(null);
    const token = validatedCaptchaToken(captchaToken);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(token ? { options: { captchaToken: token } } : {}),
    });
    if (authError) throw new Error(authError.message);
    if (!data.user) throw new Error('Sign in did not return a user. Please try again.');
    // Verify a valid role exists even when the auth listener is still resolving.
    await resolveUser(data.user.id, data.user.email || email);
  }
  function enterDemo(role: Role) {
    if (!demoEnabled) throw new Error('Demo mode is disabled.');
    try {
      sessionStorage.setItem(demoKey, role);
    } catch {
      /* In-memory fallback. */
    }
    setUser(demoUser(role));
    setError(null);
    setLoading(false);
  }
  async function signOut() {
    if (supabase) {
      const { error: logoutError } = await supabase.auth.signOut();
      if (logoutError) throw new Error(logoutError.message);
    }
    revision.current++;
    try {
      sessionStorage.removeItem(demoKey);
    } catch {
      /* In-memory fallback. */
    }
    setUser(null);
    setError(null);
  }
  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, enterDemo, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be inside AuthProvider');
  return value;
}
