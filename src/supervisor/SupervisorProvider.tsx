import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { loadSupervisorWorkspace, reviewProposal, rescreenProposal } from '../lib/supervisor-api';
import type { ReviewInput, SupervisorWorkspace } from '../types/supervisor';
interface Value {
  workspace: SupervisorWorkspace | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  screen: (id: string) => Promise<void>;
  review: (id: string, input: ReviewInput) => Promise<void>;
}
import { useWorkspace } from '../lib/use-workspace';
const Context = createContext<Value | null>(null);
export function SupervisorProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { workspace, loading, error, refresh, mutate } = useWorkspace<SupervisorWorkspace>(
    user,
    loadSupervisorWorkspace,
    'Unable to load your supervision workspace.',
  );
  return (
    <Context.Provider
      value={{
        workspace,
        loading,
        error,
        refresh,
        screen: async (id) => {
          if (user) await mutate(() => rescreenProposal(user, id));
        },
        review: async (id, input) => {
          if (user) await mutate(() => reviewProposal(user, id, input));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSupervisor() {
  const value = useContext(Context);
  if (!value) throw new Error('SupervisorProvider is required');
  return value;
}
