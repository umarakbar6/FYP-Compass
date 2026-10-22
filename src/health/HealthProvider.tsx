import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../lib/use-workspace';
import {
  loadHealthWorkspace,
  recalculateHealth,
  createHealthDraft,
  reviewHealthDraft,
  markHealthNoticeRead,
} from './api';
import type { HealthText, HealthWorkspace } from './types';
interface Value {
  workspace: HealthWorkspace | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  calculate: () => Promise<void>;
  draft: (id: string) => Promise<void>;
  review: (
    id: string,
    version: number,
    action: 'approve' | 'reject',
    text: HealthText,
  ) => Promise<void>;
  read: (id: string) => Promise<void>;
}
const Context = createContext<Value | null>(null);
export function HealthProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const state = useWorkspace(user, loadHealthWorkspace, 'Unable to load project health.');
  return (
    <Context.Provider
      value={{
        ...state,
        calculate: async () => {
          if (user) await state.mutate(() => recalculateHealth(user));
        },
        draft: async (id) => {
          if (user) await state.mutate(() => createHealthDraft(user, id));
        },
        review: async (id, version, action, text) => {
          if (user) await state.mutate(() => reviewHealthDraft(user, id, version, action, text));
        },
        read: async (id) => {
          if (user) await state.mutate(() => markHealthNoticeRead(user, id));
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useHealth() {
  const value = useContext(Context);
  if (!value) throw new Error('HealthProvider is required.');
  return value;
}
