import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  loadMilestoneWorkspace,
  submitMilestone,
  saveContribution,
  reviewMilestone,
} from '../lib/milestone-api';
import type { MilestoneWorkspace } from '../types/milestone';
interface Value {
  workspace: MilestoneWorkspace | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  submit: (
    id: string,
    file: File | null,
    statement: string,
    expected: string | null,
  ) => Promise<void>;
  contribute: (id: string, submissionId: string, statement: string) => Promise<void>;
  review: (
    id: string,
    submissionId: string,
    action: 'accepted' | 'needs_rework',
    feedback: string,
  ) => Promise<void>;
}
import { useWorkspace } from '../lib/use-workspace';
const Context = createContext<Value | null>(null);
export function MilestoneProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { workspace, loading, error, refresh, mutate } = useWorkspace<MilestoneWorkspace>(
    user,
    loadMilestoneWorkspace,
    'Unable to load milestones.',
  );
  return (
    <Context.Provider
      value={{
        workspace,
        loading,
        error,
        refresh,
        submit: async (id, file, statement, expected) => {
          if (user) await mutate(() => submitMilestone(user, id, file, statement, expected));
        },
        contribute: async (id, submissionId, statement) => {
          if (user) await mutate(() => saveContribution(user, id, submissionId, statement));
        },
        review: async (id, submissionId, action, feedback) => {
          if (user) await mutate(() => reviewMilestone(user, id, submissionId, action, feedback));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useMilestones() {
  const value = useContext(Context);
  if (!value) throw new Error('MilestoneProvider is required.');
  return value;
}
