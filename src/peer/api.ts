import { supabase, demoEnabled } from '../lib/supabase';
import type { PortalUser } from '../types/shared';
export interface PeerProject {
  id: string;
  title: string;
  members: { id: string; full_name: string }[];
  peers_required: boolean;
  my_ratings: { evaluated: string; rating: number }[];
  contribution_percents: { student_id: string; percent: number }[];
}
export interface PeerWorkspace {
  actor_id: string;
  projects: PeerProject[];
}
export function validatePeerWorkspace(data: unknown, user: PortalUser): PeerWorkspace {
  const w = data as PeerWorkspace;
  const fail = () => {
    throw new Error('Invalid or private peer workspace returned by the server.');
  };
  if (
    !w ||
    w.actor_id !== user.id ||
    !Array.isArray(w.projects) ||
    !['student', 'supervisor'].includes(user.role)
  )
    return fail();
  const seen = new Set<string>();
  for (const p of w.projects) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      seen.has(p.id) ||
      typeof p.title !== 'string' ||
      typeof p.peers_required !== 'boolean' ||
      !Array.isArray(p.members) ||
      p.members.length < 1 ||
      p.members.length > 3 ||
      p.members.some((m) => !m || typeof m.id !== 'string' || typeof m.full_name !== 'string') ||
      new Set(p.members.map((m) => m.id)).size !== p.members.length ||
      !Array.isArray(p.my_ratings) ||
      !Array.isArray(p.contribution_percents)
    )
      return fail();
    seen.add(p.id);
    if (
      user.role === 'student' &&
      (!p.members.some((m) => m.id === user.id) || p.contribution_percents.length)
    )
      return fail();
    if (user.role === 'supervisor' && p.my_ratings.length) return fail();
    if (
      p.my_ratings.some(
        (r) =>
          !r ||
          r.evaluated === user.id ||
          !p.members.some((m) => m.id === r.evaluated) ||
          !Number.isInteger(r.rating) ||
          r.rating < 1 ||
          r.rating > 5,
      ) ||
      new Set(p.my_ratings.map((r) => r.evaluated)).size !== p.my_ratings.length
    )
      return fail();
    if (
      p.contribution_percents.some(
        (c) =>
          !c ||
          !p.members.some((m) => m.id === c.student_id) ||
          !Number.isFinite(c.percent) ||
          c.percent < 0 ||
          c.percent > 100,
      )
    )
      return fail();
  }
  return w;
}
async function rpc(user: PortalUser, name: string, args?: Record<string, unknown>) {
  if (demoEnabled)
    throw new Error(
      'Peer ratings require the shared backend; local demo ratings are not submitted.',
    );
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw new Error(
      error.code === 'PGRST202'
        ? 'Install the health and peer backend migration to enable this workflow.'
        : error.message,
    );
  return validatePeerWorkspace(data, user);
}
export function loadPeerWorkspace(user: PortalUser) {
  return rpc(user, 'fyp_v2_peer_workspace');
}
export function savePeerRating(user: PortalUser, id: string, evaluated: string, rating: number) {
  if (
    user.role !== 'student' ||
    evaluated === user.id ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  )
    throw new Error('Rate another group member from one to five.');
  return rpc(user, 'fyp_v2_save_peer_rating', {
    p_project_id: id,
    p_evaluated: evaluated,
    p_rating: rating,
  });
}
export function setPeersDue(user: PortalUser, id: string, required: boolean) {
  if (user.role !== 'supervisor') throw new Error('Assigned supervisor required.');
  return rpc(user, 'fyp_v2_set_peer_due', { p_project_id: id, p_required: required });
}
export function saveContributionPercent(
  user: PortalUser,
  id: string,
  student: string,
  percent: number,
) {
  if (user.role !== 'supervisor' || !Number.isFinite(percent) || percent < 0 || percent > 100)
    throw new Error('Contribution percentage must be between zero and 100.');
  return rpc(user, 'fyp_v2_set_contribution_percent', {
    p_project_id: id,
    p_student_id: student,
    p_percent: percent,
  });
}
