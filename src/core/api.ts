import { supabase, demoEnabled } from '../lib/supabase';
import type { PortalUser } from '../types/shared';
export interface CoreSession {
  id: string;
  name: string;
  active: boolean;
}
export interface CorePerson {
  id: string;
  full_name: string;
  role: string;
}
export interface CoreConfig {
  actor_id: string;
  sessions: CoreSession[];
  topics: { id: string; name: string }[];
  participants: { profile_id: string; session_id: string }[];
  capacities: {
    session_id: string;
    supervisor_id: string;
    max_groups: number;
    topic_ids: string[];
    allocated?: number;
  }[];
  templates: { id: string; session_id: string; name: string; description: string; days: number }[];
  people: CorePerson[];
}
export interface CoreGroup {
  id: string;
  session_id: string;
  name: string;
  members: { id: string; full_name: string }[];
  proposal: {
    id: string;
    title: string;
    status: string;
    topic_ids: string[];
    supervisor_ids: string[];
    submitted_at: string | null;
  } | null;
  allocation: {
    supervisor_id: string;
    preference_rank: number | null;
    explanation: string;
    seed: string | null;
  } | null;
}
export interface CoreReport {
  actor_id: string;
  sessions: CoreSession[];
  groups: CoreGroup[];
  capacities: CoreConfig['capacities'];
  milestones: { id: string; group_id: string; name: string; deadline: string; status: string }[];
  participants: CoreConfig['participants'];
  people: CorePerson[];
  topics: CoreConfig['topics'];
  health: { project_id: string; level: string; calculated_at: string }[];
  defenses: {
    id: string;
    project_id: string;
    examiner_one: string;
    examiner_two: string;
    scheduled_at: string;
    location: string;
    assessments_received: number;
  }[];
  results: {
    id: string;
    project_id: string;
    student_id: string;
    group_mark: number;
    individual_mark: number;
    total: number;
    released_at: string | null;
  }[];
  peer_reviews: { project_id: string; students: { status: string }[] }[];
  audit: unknown[];
  assessment_audit: unknown[];
}
async function call(user: PortalUser, name: string, args?: Record<string, unknown>) {
  if (user.role !== 'coordinator') throw new Error('Coordinator access required.');
  if (!supabase || demoEnabled)
    throw new Error('Shared coordinator configuration requires the installed backend.');
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw new Error(
      error.code === 'PGRST202'
        ? 'Install the complete v2 backend before using this workspace.'
        : error.message,
    );
  if (!data || data.actor_id !== user.id) throw new Error('Workspace belongs to another account.');
  return data;
}
export async function loadCoreConfig(user: PortalUser): Promise<CoreConfig> {
  const d = await call(user, 'fyp_v2_core_configuration');
  for (const key of ['sessions', 'topics', 'participants', 'capacities', 'templates', 'people'])
    if (!Array.isArray(d[key])) throw new Error('Invalid coordinator configuration.');
  return d;
}
export async function configureCore(
  user: PortalUser,
  operation: string,
  data: Record<string, unknown>,
) {
  await call(user, 'fyp_v2_core_configure', { p_operation: operation, p_data: data });
  return loadCoreConfig(user);
}
export async function loadCoreReport(user: PortalUser): Promise<CoreReport> {
  const d = await call(user, 'fyp_v2_core_accreditation');
  for (const key of [
    'sessions',
    'groups',
    'capacities',
    'milestones',
    'participants',
    'people',
    'topics',
    'health',
    'defenses',
    'results',
    'peer_reviews',
    'audit',
    'assessment_audit',
  ])
    if (!Array.isArray(d[key])) throw new Error('Invalid accreditation report.');
  if (
    d.groups.some(
      (g: CoreGroup) =>
        !g ||
        typeof g.id !== 'string' ||
        !Array.isArray(g.members) ||
        g.members.some((m) => !m || typeof m.id !== 'string'),
    )
  )
    throw new Error('Invalid report groups.');
  return d;
}
export async function matchCore(user: PortalUser, seed: string) {
  await call(user, 'fyp_v2_core_match', { p_seed: seed });
  return loadCoreReport(user);
}
export async function manualAllocate(
  user: PortalUser,
  group: string,
  supervisor: string,
  reason: string,
) {
  await call(user, 'fyp_v2_core_manual_allocate', {
    p_group_id: group,
    p_supervisor_id: supervisor,
    p_reason: reason,
  });
  return loadCoreReport(user);
}
export function reportSummary(report: CoreReport, session: string) {
  const groups = report.groups.filter((g) => g.session_id === session);
  const ids = new Set(groups.map((g) => g.id));
  const submitted = groups.filter((g) => g.proposal?.submitted_at);
  const matched = groups.filter((g) => g.allocation);
  const results = report.results.filter((r) => ids.has(r.project_id));
  const students = report.participants.filter(
    (p) =>
      p.session_id === session &&
      report.people.some((person) => person.id === p.profile_id && person.role === 'student'),
  ).length;
  return {
    groups,
    ids,
    submitted,
    matched,
    results,
    students,
    unmatched: submitted.filter((g) => !g.allocation).length,
    completion: students
      ? Math.round((results.filter((r) => r.released_at).length / students) * 100)
      : 0,
    preferenceRates: [1, 2, 3].map((rank) =>
      matched.length
        ? Math.round(
            (matched.filter((g) => g.allocation?.preference_rank === rank).length /
              matched.length) *
              100,
          )
        : 0,
    ),
    pendingPeers: report.peer_reviews
      .filter((p) => ids.has(p.project_id))
      .flatMap((p) => p.students)
      .filter((s) => s.status === 'pending_review').length,
  };
}
