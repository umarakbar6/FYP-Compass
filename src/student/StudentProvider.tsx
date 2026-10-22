import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { loadWorkspace, createGroup, saveProposal } from '../lib/student-api';
import type { ProposalInput, StudentWorkspace } from '../types/student';
interface Value {
  workspace: StudentWorkspace | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  create: (name: string, ids: string[]) => Promise<void>;
  save: (input: ProposalInput, file: File | null, submit: boolean) => Promise<void>;
}
import { useWorkspace } from '../lib/use-workspace';
const Context = createContext<Value | null>(null);
export function StudentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { workspace, loading, error, refresh, mutate } = useWorkspace<StudentWorkspace>(
    user,
    loadWorkspace,
    'Unable to load your workspace.',
  );
  return (
    <Context.Provider
      value={{
        workspace,
        loading,
        error,
        refresh,
        create: async (name, ids) => {
          if (user) await mutate(() => createGroup(user, name, ids));
        },
        save: async (input, file, submit) => {
          if (user) await mutate(() => saveProposal(user, input, file, submit));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStudent() {
  const value = useContext(Context);
  if (!value) throw new Error('StudentProvider is required');
  return value;
}
