import { useCallback, useEffect, useRef, useState } from 'react';
import type { PortalUser } from '../types/shared';
// Discard late reads, and never let a refresh supersede an in-flight write.
export function useWorkspace<T>(
  user: PortalUser | null,
  load: (user: PortalUser) => Promise<T>,
  fallback: string,
) {
  const [workspace, setWorkspace] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const writing = useRef(false);
  const active = useRef(false);
  const refresh = useCallback(async () => {
    if (!user || !active.current || writing.current) return;
    const request = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const value = await load(user);
      if (active.current && request === revision.current) setWorkspace(value);
    } catch (cause) {
      if (active.current && request === revision.current)
        setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      if (active.current && request === revision.current) setLoading(false);
    }
  }, [user, load, fallback]);
  useEffect(() => {
    active.current = true;
    writing.current = false;
    setWorkspace(null);
    void refresh();
    return () => {
      active.current = false;
      revision.current++;
    };
  }, [refresh]);
  const mutate = useCallback(
    async (operation: () => Promise<T>) => {
      if (!user || !active.current) throw new Error('Your workspace session is no longer active.');
      if (writing.current)
        throw new Error('A workspace update is already in progress. Please wait.');
      writing.current = true;
      const request = ++revision.current;
      setError('');
      setLoading(false);
      try {
        const value = await operation();
        if (active.current && request === revision.current) setWorkspace(value);
      } finally {
        if (request === revision.current) writing.current = false;
      }
    },
    [user],
  );
  return { workspace, loading, error, refresh, mutate };
}
