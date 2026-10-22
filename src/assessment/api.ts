import { supabase, demoEnabled } from '../lib/supabase';
import type { PortalUser } from '../types/shared';
interface Member {
  id: string;
  full_name: string;
}
export interface PeerMark {
  student_id: string;
  original_mark: number | null;
  calculated_mark: number | null;
  mark: number | null;
  status: string;
  flags: string[];
  signature: string;
  reason: string | null;
  ratings: { evaluator: string; rating: number; excluded: boolean }[];
}
export interface AssessmentProject {
  id: string;
  title: string;
  members: Member[];
  milestones?: { id: string; name: string; status: string }[];
  certified: string | null;
  peer_marks?: PeerMark[];
  supervisor_marks?: {
    proposal: number;
    progress: number;
    individual: { student_id: string; mark: number }[];
  } | null;
}
export interface Defense {
  id: string;
  project_id: string;
  title: string;
  members: Member[];
  scheduled_at: string;
  location: string;
  fee_paid: boolean;
  examiner_one: string;
  examiner_two: string;
  submitted_examiners: string[];
  my_assessment: {
    examiner: string;
    report: number;
    implementation: number;
    viva: { student_id: string; mark: number }[];
    comments: string;
  } | null;
}
export interface Result {
  id: string;
  defense_id: string;
  student_id: string;
  group_components: { proposal: number; progress: number; report: number; implementation: number };
  individual_components: { contribution: number; viva: number; peer: number };
  group_mark: number;
  individual_mark: number;
  total: number;
  version: number;
  released_at: string | null;
}
export interface AssessmentWorkspace {
  actor_id: string;
  projects: AssessmentProject[];
  defenses: Defense[];
  results: Result[];
  examiners: Member[];
}
const members = (v: unknown): v is Member[] =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= 3 &&
  v.every((m) => m && typeof m.id === 'string' && typeof m.full_name === 'string') &&
  new Set(v.map((m) => m.id)).size === v.length;
function components(v: unknown, maxima: Record<string, number>) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== Object.keys(maxima).length
  )
    return false;
  return Object.entries(maxima).every(([key, max]) => {
    const n = (v as Record<string, unknown>)[key];
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  });
}
export function validateAssessmentWorkspace(value: unknown, user: PortalUser): AssessmentWorkspace {
  const w = value as AssessmentWorkspace;
  const fail = () => {
    throw new Error('Invalid or private assessment workspace returned by the server.');
  };
  if (
    !w ||
    w.actor_id !== user.id ||
    !Array.isArray(w.projects) ||
    !Array.isArray(w.defenses) ||
    !Array.isArray(w.results) ||
    !Array.isArray(w.examiners)
  )
    return fail();
  if (
    w.projects.some(
      (p) =>
        !p ||
        typeof p.id !== 'string' ||
        typeof p.title !== 'string' ||
        !members(p.members) ||
        (p.milestones !== undefined &&
          (!Array.isArray(p.milestones) ||
            p.milestones.some(
              (m) => !m || typeof m.id !== 'string' || typeof m.status !== 'string',
            ))) ||
        (p.peer_marks !== undefined &&
          (!Array.isArray(p.peer_marks) ||
            user.role !== 'coordinator' ||
            p.peer_marks.some(
              (m) =>
                !m ||
                typeof m.student_id !== 'string' ||
                !p.members.some((member) => member.id === m.student_id) ||
                typeof m.signature !== 'string' ||
                !['pending_review', 'clear', 'reviewed'].includes(m.status) ||
                !Array.isArray(m.flags) ||
                m.flags.some((f) => typeof f !== 'string') ||
                !Array.isArray(m.ratings) ||
                m.ratings.some(
                  (r) =>
                    !r ||
                    typeof r.evaluator !== 'string' ||
                    !Number.isInteger(r.rating) ||
                    r.rating < 1 ||
                    r.rating > 5 ||
                    typeof r.excluded !== 'boolean',
                ),
            ))) ||
        (p.supervisor_marks &&
          (!Number.isFinite(p.supervisor_marks.proposal) ||
            !Number.isFinite(p.supervisor_marks.progress) ||
            !Array.isArray(p.supervisor_marks.individual))),
    )
  )
    return fail();
  for (const d of w.defenses) {
    if (
      !d ||
      typeof d.id !== 'string' ||
      !members(d.members) ||
      typeof d.title !== 'string' ||
      typeof d.location !== 'string' ||
      typeof d.fee_paid !== 'boolean' ||
      !Number.isFinite(Date.parse(d.scheduled_at)) ||
      typeof d.examiner_one !== 'string' ||
      typeof d.examiner_two !== 'string' ||
      d.examiner_one === d.examiner_two ||
      !Array.isArray(d.submitted_examiners)
    )
      return fail();
    if (
      d.my_assessment &&
      (!components(
        { report: d.my_assessment.report, implementation: d.my_assessment.implementation },
        { report: 15, implementation: 15 },
      ) ||
        !Array.isArray(d.my_assessment.viva) ||
        d.my_assessment.viva.some(
          (v) =>
            !v ||
            !d.members.some((m) => m.id === v.student_id) ||
            !Number.isFinite(v.mark) ||
            v.mark < 0 ||
            v.mark > 20,
        ))
    )
      return fail();
    if (
      user.role === 'examiner' &&
      (![d.examiner_one, d.examiner_two].includes(user.id) ||
        d.submitted_examiners.length ||
        (d.my_assessment && d.my_assessment.examiner !== user.id))
    )
      return fail();
  }
  for (const r of w.results) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      typeof r.student_id !== 'string' ||
      !Number.isFinite(r.group_mark) ||
      r.group_mark < 0 ||
      r.group_mark > 55 ||
      !Number.isFinite(r.individual_mark) ||
      r.individual_mark < 0 ||
      r.individual_mark > 45 ||
      !Number.isFinite(r.total) ||
      Math.abs(r.total - r.group_mark - r.individual_mark) > 0.011 ||
      !Number.isInteger(r.version) ||
      r.version < 1 ||
      !components(r.group_components, {
        proposal: 10,
        progress: 15,
        report: 15,
        implementation: 15,
      }) ||
      !components(r.individual_components, { contribution: 15, viva: 20, peer: 10 }) ||
      Math.abs(Object.values(r.group_components).reduce((a, b) => a + b, 0) - r.group_mark) >
        0.011 ||
      Math.abs(
        Object.values(r.individual_components).reduce((a, b) => a + b, 0) - r.individual_mark,
      ) > 0.011
    )
      return fail();
    if (
      user.role === 'student' &&
      (r.student_id !== user.id || !r.released_at || !Number.isFinite(Date.parse(r.released_at)))
    )
      return fail();
  }
  if (['student', 'examiner'].includes(user.role) && w.projects.length) return fail();
  if (user.role === 'student' && (w.defenses.length || w.examiners.length)) return fail();
  if (['supervisor', 'examiner'].includes(user.role) && (w.results.length || w.examiners.length))
    return fail();
  if (w.examiners.some((e) => !e || typeof e.id !== 'string' || typeof e.full_name !== 'string'))
    return fail();
  for (const collection of [w.projects, w.defenses, w.results, w.examiners])
    if (new Set(collection.map((x) => x.id)).size !== collection.length) return fail();
  return w;
}
export async function loadAssessmentWorkspace(user: PortalUser) {
  if (demoEnabled)
    throw new Error(
      'Assessment and released results require the shared backend. No local grades are published.',
    );
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('fyp_v2_assessment_workspace');
  if (error)
    throw new Error(
      error.code === 'PGRST202'
        ? 'Install the assessment backend migration to enable this workflow.'
        : error.message,
    );
  return validateAssessmentWorkspace(data, user);
}
const operations = new Set([
  'fyp_v2_certify_defense',
  'fyp_v2_schedule_defense',
  'fyp_v2_review_peer_mark',
  'fyp_v2_save_supervisor_marks',
  'fyp_v2_submit_examiner_marks',
  'fyp_v2_finalize_results',
  'fyp_v2_release_results',
  'fyp_v2_correct_result',
  'fyp_governance_save_supervisor_marks',
  'fyp_governance_submit_examiner_marks',
]);
export async function updateAssessment(
  user: PortalUser,
  name: string,
  args: Record<string, unknown>,
) {
  if (!operations.has(name) || !supabase || demoEnabled)
    throw new Error('Assessment backend is unavailable.');
  const { error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return loadAssessmentWorkspace(user);
}
