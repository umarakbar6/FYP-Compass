import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import {
  engagementAction,
  getEngagementWorkspace,
  saveCase,
  type CaseStudy,
  type EngagementWorkspace,
} from './api';
interface Context {
  workspace: EngagementWorkspace | null;
  error: string;
  busy: boolean;
  reload: () => Promise<void>;
  action: (name: string, data: object) => Promise<void>;
  publishCase: (item: CaseStudy) => Promise<boolean>;
}
const Context = createContext<Context>({
  workspace: null,
  error: '',
  busy: false,
  reload: async () => {},
  action: async () => {},
  publishCase: async () => false,
});
export function useEngagement() {
  return useContext(Context);
}
export function EngagementProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth(),
    [workspace, setWorkspace] = useState<EngagementWorkspace | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const generation = useRef(0),
    currentUser = useRef(user?.id);
  currentUser.current = user?.id;
  const reload = useCallback(async () => {
    if (writing.current) return;
    const token = ++generation.current;
    if (!user || !supabase) return;
    try {
      const data = await getEngagementWorkspace();
      if (token === generation.current) {
        setWorkspace(data);
        setError('');
      }
    } catch (cause) {
      if (token === generation.current)
        setError(cause instanceof Error ? cause.message : 'Unable to load help and reminders.');
    }
  }, [user?.id]);
  useEffect(() => {
    setWorkspace(null);
    setError('');
    setBusy(false);
    void reload();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 60000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [reload]);
  async function mutate(operation: () => Promise<EngagementWorkspace>) {
    if (!user || !supabase || writing.current) return false;
    const id = user.id;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await operation();
      if (currentUser.current === id) {
        generation.current++;
        setWorkspace(data);
      }
      return true;
    } catch (cause) {
      if (currentUser.current === id)
        setError(cause instanceof Error ? cause.message : 'The change could not be saved.');
      return false;
    } finally {
      writing.current = false;
      if (currentUser.current === id) setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        workspace,
        error,
        busy,
        reload,
        action: async (name, data) => {
          await mutate(() => engagementAction(name, data));
        },
        publishCase: (item) => mutate(() => saveCase(item)),
      }}
    >
      {children}
    </Context.Provider>
  );
}
