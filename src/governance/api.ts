import { demoEnabled, supabase } from '../lib/supabase';
import type { PortalUser } from '../types/shared';

export const componentCaps = {
  proposal: 10,
  progress: 15,
  contribution: 15,
  report: 15,
  implementation: 15,
  viva: 20,
} as const;
export type RubricComponent = keyof typeof componentCaps;
export type RubricCriterion = {
  id: string;
  component: RubricComponent;
  label: string;
  guidance: string;
  points: number;
};
export type Rubric = {
  id: string;
  version: number;
  name: string;
  description: string;
  criteria: RubricCriterion[];
  active?: boolean;
  created_at: string;
};
export type GovernanceProject = {
  id: string;
  name: string;
  title: string;
  supervisor_id: string | null;
  members: { id: string; full_name: string }[];
};
export type SupervisionMeeting = {
  id: string;
  group_id: string;
  starts_at: string;
  duration_minutes: number;
  location: string;
  agenda: string;
  status: 'requested' | 'scheduled' | 'completed' | 'cancelled';
  minutes: string | null;
  decisions: string[];
  action_items: string[];
  created_by: string;
  version: number;
};
export type FeedbackItem = {
  id: string;
  group_id: string;
  source_type: 'proposal' | 'milestone' | 'meeting' | 'general';
  source_id: string;
  title: string;
  details: string;
  status: 'open' | 'addressed' | 'verified' | 'reopened';
  student_response: string | null;
  created_by: string;
  version: number;
  created_at: string;
};
export type GovernanceWorkspace = {
  actor_id: string;
  role: 'student' | 'supervisor' | 'coordinator';
  projects: GovernanceProject[];
  active_rubric: Rubric | null;
  rubrics: Rubric[];
  meetings: SupervisionMeeting[];
  feedback: FeedbackItem[];
};

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const textList = (v: unknown) => Array.isArray(v) && v.every((x) => text(x, 500));
export function validateRubric(value: unknown): Rubric {
  const r = value as Rubric;
  if (
    !r ||
    !text(r.id, 80) ||
    !Number.isInteger(r.version) ||
    r.version < 1 ||
    !text(r.name, 120) ||
    typeof r.description !== 'string' ||
    !Array.isArray(r.criteria) ||
    r.criteria.length < 6 ||
    !Number.isFinite(Date.parse(r.created_at))
  )
    throw Error('Invalid assessment rubric returned by the server.');
  for (const c of r.criteria)
    if (
      !c ||
      !/^[a-z0-9_]{2,40}$/.test(c.id) ||
      !(c.component in componentCaps) ||
      !text(c.label, 120) ||
      typeof c.guidance !== 'string' ||
      c.guidance.length > 1000 ||
      !Number.isFinite(c.points) ||
      c.points <= 0
    )
      throw Error('Invalid assessment rubric returned by the server.');
  if (new Set(r.criteria.map((c) => c.id)).size !== r.criteria.length)
    throw Error('Assessment rubric criterion ids must be unique.');
  for (const [component, cap] of Object.entries(componentCaps)) {
    const total = r.criteria
      .filter((c) => c.component === component)
      .reduce((s, c) => s + c.points, 0);
    if (Math.abs(total - cap) > 0.001)
      throw Error('Assessment rubric component totals are inconsistent.');
  }
  return r;
}
export function validateGovernanceWorkspace(value: unknown, user: PortalUser): GovernanceWorkspace {
  const w = value as GovernanceWorkspace;
  const fail = () => {
    throw Error('Invalid or private project governance data returned by the server.');
  };
  if (
    !w ||
    w.actor_id !== user.id ||
    w.role !== user.role ||
    !['student', 'supervisor', 'coordinator'].includes(w.role) ||
    !Array.isArray(w.projects) ||
    !Array.isArray(w.rubrics) ||
    !Array.isArray(w.meetings) ||
    !Array.isArray(w.feedback)
  )
    return fail();
  try {
    if (w.active_rubric) validateRubric(w.active_rubric);
    w.rubrics.forEach(validateRubric);
  } catch {
    return fail();
  }
  const ids = new Set(w.projects.map((p) => p.id));
  if (
    ids.size !== w.projects.length ||
    w.projects.some(
      (p) =>
        !text(p.id, 80) || !text(p.name, 120) || !text(p.title, 400) || !Array.isArray(p.members),
    ) ||
    w.meetings.some(
      (m) =>
        !ids.has(m.group_id) ||
        !Number.isFinite(Date.parse(m.starts_at)) ||
        !Number.isInteger(m.duration_minutes) ||
        m.duration_minutes < 15 ||
        m.duration_minutes > 240 ||
        !text(m.location, 240) ||
        !text(m.agenda, 4000) ||
        !['requested', 'scheduled', 'completed', 'cancelled'].includes(m.status) ||
        !textList(m.decisions) ||
        !textList(m.action_items) ||
        !Number.isInteger(m.version),
    ) ||
    w.feedback.some(
      (f) =>
        !ids.has(f.group_id) ||
        !text(f.title, 180) ||
        !text(f.details, 6000) ||
        !['open', 'addressed', 'verified', 'reopened'].includes(f.status) ||
        (f.student_response !== null && !text(f.student_response, 6000)) ||
        !Number.isInteger(f.version),
    )
  )
    return fail();
  if (user.role !== 'coordinator' && w.rubrics.length) return fail();
  return w;
}
export async function loadGovernanceWorkspace(user: PortalUser) {
  if (!supabase || demoEnabled) throw Error('Project governance requires the connected workspace.');
  const { data, error } = await supabase.rpc('fyp_governance_workspace');
  if (error)
    throw Error(
      error.code === 'PGRST202'
        ? 'Install the project governance backend migration to enable this workspace.'
        : error.message,
    );
  return validateGovernanceWorkspace(data, user);
}
export async function loadActiveRubric() {
  if (!supabase || demoEnabled) return null;
  const { data, error } = await supabase.rpc('fyp_governance_active_rubric');
  if (error)
    throw Error(
      error.code === 'PGRST202'
        ? 'Install the project governance backend migration to enable custom rubrics.'
        : error.message,
    );
  return data ? validateRubric(data) : null;
}
const operations = new Set([
  'fyp_governance_save_rubric',
  'fyp_governance_book_meeting',
  'fyp_governance_update_meeting',
  'fyp_governance_create_feedback',
  'fyp_governance_respond_feedback',
  'fyp_governance_review_feedback',
]);
export async function updateGovernance(
  user: PortalUser,
  operation: string,
  args: Record<string, unknown>,
) {
  if (!supabase || demoEnabled || !operations.has(operation))
    throw Error('Project governance backend is unavailable.');
  const { data, error } = await supabase.rpc(operation, args);
  if (error) throw Error(error.message);
  return validateGovernanceWorkspace(data, user);
}
export const criteriaFor = (rubric: Rubric | null, component: RubricComponent) =>
  rubric?.criteria.filter((c) => c.component === component) || [];
