import { readableCopy } from '../lib/readable-copy';
import { formatHealthEvidence } from './format-evidence';
import { useCallback, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from '../lib/use-workspace';
import { supabase } from '../lib/supabase';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import type { PortalUser } from '../types/shared';
import type { HealthResult, HealthLevel } from './types';
interface Oversight {
  actor_id: string;
  selected_session: string | null;
  sessions: { id: string; name: string; active: boolean }[];
  projects: {
    id: string;
    name: string;
    title: string;
    supervisor_name: string | null;
    health: HealthResult | null;
    draft_count: number;
  }[];
  notices: {
    id: string;
    project_name: string;
    body: string;
    level: HealthLevel;
    source: string;
    created_at: string;
    recipients_count: number;
    read_count: number;
  }[];
}
export async function loadCoordinatorHealth(
  user: PortalUser,
  session: string | null,
): Promise<Oversight> {
  if (user.role !== 'coordinator') throw new Error('Coordinator access required.');
  if (!supabase) throw new Error('Connect the project database to load health oversight.');
  const { data, error } = await supabase.rpc('fyp_coordinator_health', { p_session_id: session });
  if (error) throw new Error(error.message);
  if (
    !data ||
    data.actor_id !== user.id ||
    !Array.isArray(data.sessions) ||
    !Array.isArray(data.projects) ||
    !Array.isArray(data.notices)
  )
    throw new Error('Health oversight records could not be read.');
  return data;
}
export function CoordinatorHealth({ notices = false }: { notices?: boolean }) {
  const { user } = useAuth();
  const [session, setSession] = useState<string | null>(null);
  const loader = useCallback(
    (actor: PortalUser) => loadCoordinatorHealth(actor, session),
    [session],
  );
  const state = useWorkspace(user, loader, 'Unable to load health oversight.');
  const w = state.workspace;
  return (
    <div className="assessment-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">COORDINATOR OVERSIGHT</span>
          <h1>{notices ? 'Published health notices' : 'Project health oversight'}</h1>
          <p>
            {notices
              ? 'Review messages approved by assigned supervisors and their delivery status.'
              : 'Review saved project health across academic sessions. Assigned supervisors generate and review AI drafts.'}
          </p>
        </div>
        <Button disabled={state.loading} onClick={() => void state.refresh()}>
          Refresh
        </Button>
      </div>
      {state.error && <ErrorMessage message={state.error} />}
      {state.loading ? (
        <LoadingState />
      ) : (
        w && (
          <>
            <label>
              Academic session
              <select
                value={session ?? w.selected_session ?? ''}
                onChange={(e) => setSession(e.target.value || null)}
              >
                <option value="" disabled>
                  Choose session
                </option>
                {w.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.active ? ' (active)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {notices ? (
              w.notices.length ? (
                w.notices.map((n) => (
                  <section className="assessment-card" key={n.id}>
                    <h2>{n.project_name}</h2>
                    <StatusBadge tone={n.level}>{n.level.toUpperCase()}</StatusBadge>
                    <p>{readableCopy(n.body)}</p>
                    <p>
                      {n.source === 'gemini' ? 'Gemini explanation' : 'Rule based explanation'} ·
                      Published {new Date(n.created_at).toLocaleString()}
                    </p>
                    <p>
                      {n.read_count} of {n.recipients_count} recipients have read this notice.
                    </p>
                  </section>
                ))
              ) : (
                <EmptyState
                  title="No published notices in this session"
                  description="Draft and rejected messages are not delivered to students."
                />
              )
            ) : w.projects.length ? (
              w.projects.map((p) => (
                <section className="assessment-card" key={p.id}>
                  <h2>{p.name}</h2>
                  <p>{p.title}</p>
                  <p>Supervisor: {p.supervisor_name ?? 'Not allocated'}</p>
                  {p.health ? (
                    <>
                      <StatusBadge tone={p.health.level}>
                        {p.health.level.toUpperCase()}
                      </StatusBadge>
                      <p>Last calculated {new Date(p.health.calculated_at).toLocaleString()}</p>
                      {p.health.rules.length ? (
                        <ul>
                          {p.health.rules.map((r, i) => (
                            <li key={i}>
                              {r.code.replaceAll('_', ' ')}: {formatHealthEvidence(r.evidence)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No health rules triggered.</p>
                      )}
                    </>
                  ) : (
                    <p>Awaiting the first health calculation.</p>
                  )}
                  <p>{p.draft_count} drafts awaiting supervisor review.</p>
                </section>
              ))
            ) : (
              <EmptyState
                title="No approved projects in this session"
                description="Project health becomes available after proposal approval."
              />
            )}
          </>
        )
      )}
    </div>
  );
}
