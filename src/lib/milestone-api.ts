import { verifyUploadedDocument } from './verify-document';
import { rpcName, submissionBucket } from './backend-version';
import { demoEnabled, supabase } from './supabase';
import type { PortalUser, TimingStatus } from '../types/shared';
import type {
  Milestone,
  MilestoneProject,
  MilestoneSubmission,
  MilestoneWorkspace,
} from '../types/milestone';
const key = 'fyp-compass.milestones.v1';
const bucket = submissionBucket;
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
export const latestSubmission = (item: Milestone) => item.submissions.at(-1);
export function milestoneTiming(item: Milestone, now = Date.now()): TimingStatus | null {
  const submission = latestSubmission(item);
  if (submission)
    return Date.parse(submission.submitted_at) <= Date.parse(item.deadline) ? 'on_time' : 'late';
  return now > Date.parse(item.deadline) ? 'overdue' : null;
}
export function initialMilestoneProjects(): MilestoneProject[] {
  const members = [
    { id: 'demo-student', full_name: 'Ayesha Khan' },
    { id: 'student-farhan', full_name: 'Farhan Ahmed' },
    { id: 'student-zain', full_name: 'Zain Abbas' },
  ];
  const submission = (id: string, days: number, accepted = false): MilestoneSubmission => ({
    id,
    submitted_by: 'demo-student',
    submitted_at: date(days),
    document: { name: 'project-plan.pdf', size: 2048, path: null },
    contributions: members.map((member, i) => ({
      student_id: member.id,
      statement: [
        'Prepared the requirements and user journeys.',
        'Designed the data model and API contract.',
        'Researched related systems and prepared the evaluation plan.',
      ][i],
      updated_at: date(days),
    })),
    review: accepted
      ? {
          action: 'accepted',
          feedback: 'Clear scope and useful supporting evidence. Keep the evaluation measurable.',
          reviewer_id: 'demo-supervisor',
          reviewed_at: date(-1),
        }
      : null,
  });
  return [
    {
      id: 'demo-milestone-project',
      group_name: 'Team Compass · prepared project',
      title: 'FYP Supervision Portal',
      supervisor_id: 'demo-supervisor',
      members,
      milestones: [
        {
          id: 'milestone-plan',
          name: 'Requirements and project plan',
          description: 'Submit requirements, scope, timeline, and an evaluation plan.',
          deadline: date(2),
          status: 'submitted',
          submissions: [submission('submission-plan', -1)],
        },
        {
          id: 'milestone-design',
          name: 'Design and prototype',
          description: 'Document the architecture, interface designs, and prototype evidence.',
          deadline: date(-1),
          status: 'not_started',
          submissions: [],
        },
        {
          id: 'milestone-progress',
          name: 'Implementation and progress report',
          description: 'Provide implementation progress, tests, and next steps.',
          deadline: date(-4),
          status: 'accepted',
          submissions: [submission('submission-progress', -2, true)],
        },
      ],
    },
  ];
}
function permitted(user: PortalUser, project: MilestoneProject) {
  return user.role === 'supervisor'
    ? project.supervisor_id === user.id
    : user.role === 'student' && project.members.some((member) => member.id === user.id);
}
function roleCheck(user: PortalUser) {
  if (!['student', 'supervisor'].includes(user.role))
    throw new Error('Only students and assigned supervisors can access milestones.');
}
function persist(projects: MilestoneProject[]) {
  try {
    localStorage.setItem(key, JSON.stringify(projects));
  } catch {
    throw new Error(
      'Your browser could not save milestone records. Enable local storage and retry.',
    );
  }
}
export function validateMilestoneWorkspace(data: unknown, user: PortalUser): MilestoneWorkspace {
  const value = data as MilestoneWorkspace;
  const fail = () => {
    throw new Error('Milestone records are invalid. Check the Phase 4 backend contract.');
  };
  const validDate = (date: unknown) =>
    typeof date === 'string' && Number.isFinite(Date.parse(date));
  if (!value || value.actor_id !== user.id || !Array.isArray(value.projects)) return fail();
  const ids = new Set<string>();
  for (const project of value.projects) {
    if (
      !project ||
      typeof project.id !== 'string' ||
      typeof project.title !== 'string' ||
      typeof project.group_name !== 'string' ||
      typeof project.supervisor_id !== 'string' ||
      !Array.isArray(project.members) ||
      project.members.length < 1 ||
      project.members.length > 3 ||
      !project.members.every(
        (member) => member && typeof member.id === 'string' && typeof member.full_name === 'string',
      ) ||
      new Set(project.members.map((member) => member.id)).size !== project.members.length ||
      !permitted(user, project) ||
      !Array.isArray(project.milestones)
    )
      return fail();
    if (ids.has(project.id)) return fail();
    ids.add(project.id);
    for (const item of project.milestones) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        ids.has(item.id) ||
        typeof item.name !== 'string' ||
        typeof item.description !== 'string' ||
        !validDate(item.deadline) ||
        !['not_started', 'submitted', 'needs_rework', 'accepted'].includes(item.status) ||
        !Array.isArray(item.submissions)
      )
        return fail();
      ids.add(item.id);
      for (const entry of item.submissions) {
        if (
          !entry ||
          typeof entry.id !== 'string' ||
          ids.has(entry.id) ||
          !project.members.some((member) => member.id === entry.submitted_by) ||
          !validDate(entry.submitted_at) ||
          !entry.document ||
          typeof entry.document.name !== 'string' ||
          !Number.isFinite(entry.document.size) ||
          entry.document.size <= 0 ||
          (entry.document.path !== null && typeof entry.document.path !== 'string') ||
          !Array.isArray(entry.contributions)
        )
          return fail();
        ids.add(entry.id);
        if (
          !entry.contributions.every(
            (c) =>
              c &&
              project.members.some((member) => member.id === c.student_id) &&
              typeof c.statement === 'string' &&
              c.statement.trim().length > 0 &&
              c.statement.length <= 4000 &&
              validDate(c.updated_at),
          ) ||
          new Set(entry.contributions.map((c) => c.student_id)).size !== entry.contributions.length
        )
          return fail();
        if (
          entry.review !== null &&
          (!entry.review ||
            !['accepted', 'needs_rework'].includes(entry.review.action) ||
            entry.review.reviewer_id !== project.supervisor_id ||
            typeof entry.review.feedback !== 'string' ||
            (entry.review.action === 'needs_rework' && !entry.review.feedback.trim()) ||
            !validDate(entry.review.reviewed_at))
        )
          return fail();
      }
      const latest = latestSubmission(item);
      if (
        (item.status === 'not_started' && item.submissions.length) ||
        (item.status !== 'not_started' && !latest) ||
        (item.status === 'submitted' && latest?.review) ||
        (['accepted', 'needs_rework'].includes(item.status) &&
          latest?.review?.action !== item.status)
      )
        return fail();
    }
  }
  return value;
}
async function rpc(user: PortalUser, name: string, args?: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc(rpcName(name), args);
  if (error) throw new Error(`Milestone request failed: ${error.message}`);
  return validateMilestoneWorkspace(data, user);
}
function demoProjects(): MilestoneProject[] {
  try {
    const stored = localStorage.getItem(key);
    const projects = stored ? JSON.parse(stored) : initialMilestoneProjects();
    if (
      !Array.isArray(projects) ||
      !projects.every(
        (project) =>
          project &&
          typeof project.supervisor_id === 'string' &&
          Array.isArray(project.members) &&
          project.members.every(
            (member: { id?: unknown } | null) => member && typeof member.id === 'string',
          ),
      )
    )
      throw new Error('Invalid project data.');
    if (!stored) persist(projects);
    return projects;
  } catch {
    throw new Error(
      'Saved milestone demo data could not be read. Enable storage or clear this site’s milestone demo data.',
    );
  }
}
export async function loadMilestoneWorkspace(user: PortalUser) {
  roleCheck(user);
  if (!demoEnabled) return rpc(user, 'get_milestone_workspace');
  const projects = demoProjects();
  if (!Array.isArray(projects)) throw new Error('Saved milestone demo data is invalid.');
  return validateMilestoneWorkspace(
    { actor_id: user.id, projects: projects.filter((project) => permitted(user, project)) },
    user,
  );
}
function find(workspace: MilestoneWorkspace, id: string) {
  for (const project of workspace.projects) {
    const item = project.milestones.find((m) => m.id === id);
    if (item) return { project, item };
  }
  throw new Error('This milestone is not available in your assigned project.');
}
function statementCheck(statement: string) {
  if (!statement.trim() || statement.trim().length > 4000)
    throw new Error('Add your individual contribution statement (up to 4,000 characters).');
}
function replace(user: PortalUser, project: MilestoneProject, item: Milestone) {
  const projects = demoProjects().map((p) =>
    p.id === project.id
      ? { ...p, milestones: p.milestones.map((m) => (m.id === item.id ? item : m)) }
      : p,
  );
  persist(projects);
  return validateMilestoneWorkspace(
    { actor_id: user.id, projects: projects.filter((p) => permitted(user, p)) },
    user,
  );
}
export async function submitMilestone(
  user: PortalUser,
  id: string,
  file: File | null,
  statement: string,
  expectedSubmission: string | null,
) {
  if (user.role !== 'student') throw new Error('Only group students can submit milestones.');
  const { project, item } = find(await loadMilestoneWorkspace(user), id);
  if (
    !['not_started', 'needs_rework'].includes(item.status) ||
    (latestSubmission(item)?.id || null) !== expectedSubmission
  )
    throw new Error('This milestone changed or is locked. Refresh before submitting.');
  statementCheck(statement);
  if (!file || !/\.(pdf|docx)$/i.test(file.name) || file.size <= 0 || file.size > 10 * 1024 * 1024)
    throw new Error('Choose a PDF or DOCX file with content, up to 10 MB.');
  let path: string | null = null;
  if (!demoEnabled) {
    path = `${user.id}/${project.id}/${id}/${crypto.randomUUID()}.${file.name.split('.').pop()!.toLowerCase()}`;
    const { error } = await supabase!.storage.from(bucket).upload(path, file, { upsert: false });
    if (error) throw new Error(`Milestone upload failed: ${error.message}`);
    await verifyUploadedDocument(path, file.name);
    // Keep uploads on ambiguous RPC failures; server cleanup handles unreferenced objects.
    return rpc(user, 'submit_student_milestone', {
      p_milestone_id: id,
      p_document: { name: file.name, size: file.size, path },
      p_statement: statement.trim(),
      p_expected_submission_id: expectedSubmission,
    });
  }
  const now = new Date().toISOString();
  return replace(user, project, {
    ...item,
    status: 'submitted',
    submissions: [
      ...item.submissions,
      {
        id: crypto.randomUUID(),
        submitted_by: user.id,
        submitted_at: now,
        document: { name: file.name, size: file.size, path },
        contributions: [{ student_id: user.id, statement: statement.trim(), updated_at: now }],
        review: null,
      },
    ],
  });
}
export async function saveContribution(
  user: PortalUser,
  id: string,
  submissionId: string,
  statement: string,
) {
  if (user.role !== 'student') throw new Error('Only students can save their own contribution.');
  const { project, item } = find(await loadMilestoneWorkspace(user), id);
  const latest = latestSubmission(item);
  if (item.status !== 'submitted' || latest?.id !== submissionId)
    throw new Error('This submission changed or is locked. Refresh before saving.');
  statementCheck(statement);
  if (!demoEnabled)
    return rpc(user, 'save_milestone_contribution', {
      p_milestone_id: id,
      p_submission_id: submissionId,
      p_statement: statement.trim(),
    });
  const updated = {
    ...latest,
    contributions: [
      ...latest.contributions.filter((c) => c.student_id !== user.id),
      { student_id: user.id, statement: statement.trim(), updated_at: new Date().toISOString() },
    ],
  };
  return replace(user, project, {
    ...item,
    submissions: item.submissions.map((s) => (s.id === latest.id ? updated : s)),
  });
}
export async function reviewMilestone(
  user: PortalUser,
  id: string,
  submissionId: string,
  action: 'accepted' | 'needs_rework',
  feedback: string,
) {
  if (user.role !== 'supervisor')
    throw new Error('Only assigned supervisors can review milestones.');
  const { project, item } = find(await loadMilestoneWorkspace(user), id);
  const latest = latestSubmission(item);
  if (item.status !== 'submitted' || latest?.id !== submissionId)
    throw new Error('This submission changed or was already reviewed. Refresh before reviewing.');
  if (!['accepted', 'needs_rework'].includes(action))
    throw new Error('Choose a valid review action.');
  if (feedback.length > 4000 || (action === 'needs_rework' && !feedback.trim()))
    throw new Error('Rework needs feedback; keep feedback within 4,000 characters.');
  if (!demoEnabled)
    return rpc(user, 'review_supervisor_milestone', {
      p_milestone_id: id,
      p_submission_id: submissionId,
      p_action: action,
      p_feedback: feedback.trim(),
      p_expected_status: 'submitted',
    });
  const updated = {
    ...latest,
    review: {
      action,
      feedback: feedback.trim(),
      reviewer_id: user.id,
      reviewed_at: new Date().toISOString(),
    },
  };
  return replace(user, project, {
    ...item,
    status: action,
    submissions: item.submissions.map((s) => (s.id === latest.id ? updated : s)),
  });
}
export async function milestoneDocumentUrl(document: MilestoneSubmission['document']) {
  if (!document.path || !supabase)
    throw new Error('Demo files contain metadata only. Downloads need connected private storage.');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(document.path, 60);
  if (error) throw new Error(`Could not open the document: ${error.message}`);
  return data.signedUrl;
}
