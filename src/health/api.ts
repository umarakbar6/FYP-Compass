import { demoEnabled, supabase } from '../lib/supabase';
import { loadMilestoneWorkspace } from '../lib/milestone-api';
import type { PortalUser } from '../types/shared';
import type { MilestoneProject } from '../types/milestone';
import type {
  HealthInput,
  HealthWorkspace,
  HealthProject,
  HealthReport,
  HealthNotice,
  HealthText,
} from './types';
import { calculateHealth } from './rules';
import { generateHealthText, validateHealthText } from './agent';
const storeKey = 'fyp-compass.health.v1';
interface Store {
  demo_anchor?: number;
  projects: HealthProject[];
  reports: HealthReport[];
  notices: HealthNotice[];
}
function allowed(user: PortalUser, project: HealthProject) {
  return user.role === 'supervisor'
    ? project.supervisor_id === user.id
    : user.role === 'student' && project.member_ids.includes(user.id);
}
function role(user: PortalUser) {
  if (!['student', 'supervisor'].includes(user.role))
    throw new Error('Only students and assigned supervisors can access this health workspace.');
}
function read(): Store {
  try {
    const raw = localStorage.getItem(storeKey);
    return raw ? JSON.parse(raw) : { projects: [], reports: [], notices: [] };
  } catch {
    throw new Error('Saved health demo data could not be read. Reset this site’s health storage.');
  }
}
function save(store: Store) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(store));
  } catch {
    throw new Error('Health records could not be saved. Enable local storage and retry.');
  }
}
function validateStore(value: Store): Store {
  const fail = () => {
    throw new Error('Health workspace data is invalid. Check the health backend contract.');
  };
  const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  if (
    !value ||
    (value.demo_anchor !== undefined && !Number.isFinite(value.demo_anchor)) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.reports) ||
    !Array.isArray(value.notices)
  )
    return fail();
  for (const p of value.projects) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.title !== 'string' ||
      typeof p.supervisor_id !== 'string' ||
      !Array.isArray(p.member_ids) ||
      !p.member_ids.length ||
      p.member_ids.length > 3 ||
      p.member_ids.some((id) => typeof id !== 'string') ||
      new Set(p.member_ids).size !== p.member_ids.length ||
      typeof p.prepared !== 'boolean' ||
      !p.health ||
      !['green', 'amber', 'red'].includes(p.health.level) ||
      typeof p.health.fingerprint !== 'string' ||
      !date(p.health.calculated_at) ||
      !Array.isArray(p.health.rules) ||
      p.health.rules.some(
        (r) =>
          !r ||
          typeof r.code !== 'string' ||
          !['amber', 'red'].includes(r.level) ||
          typeof r.evidence !== 'string',
      )
    )
      return fail();
    if (
      (p.health.rules.some((r) => r.level === 'red')
        ? 'red'
        : p.health.rules.length
          ? 'amber'
          : 'green') !== p.health.level
    )
      return fail();
  }
  for (const r of value.reports) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !value.projects.some((p) => p.id === r.project_id) ||
      typeof r.risk_fingerprint !== 'string' ||
      !['gemini', 'fallback'].includes(r.source) ||
      !['draft', 'approved', 'rejected'].includes(r.status) ||
      !Number.isInteger(r.version) ||
      r.version < 1 ||
      !date(r.created_at) ||
      (r.reviewed_at !== null && !date(r.reviewed_at)) ||
      (r.reviewer_id !== null && typeof r.reviewer_id !== 'string')
    )
      return fail();
    validateHealthText({ explanation: r.explanation, action: r.action, message: r.message });
    const project = value.projects.find((p) => p.id === r.project_id)!;
    if (
      (r.status === 'draft' && (r.reviewed_at !== null || r.reviewer_id !== null)) ||
      // The backend rejects superseded drafts automatically without a human reviewer.
      (r.status !== 'draft' && !r.reviewed_at) ||
      (r.status === 'approved' && r.reviewer_id !== project.supervisor_id) ||
      (r.status === 'rejected' &&
        (r.reviewer_id === null ? r.version < 2 : r.reviewer_id !== project.supervisor_id))
    )
      return fail();
  }
  for (const n of value.notices) {
    const report = value.reports.find((r) => r.id === n?.report_id);
    const project = value.projects.find((p) => p.id === n?.project_id);
    if (
      !n ||
      typeof n.id !== 'string' ||
      !report ||
      report.status !== 'approved' ||
      report.project_id !== n.project_id ||
      !project ||
      n.body !== report.message ||
      !['green', 'amber', 'red'].includes(n.level) ||
      !date(n.created_at) ||
      !Array.isArray(n.read_by) ||
      n.read_by.some((id) => !project.member_ids.includes(id)) ||
      new Set(n.read_by).size !== n.read_by.length
    )
      return fail();
  }
  for (const records of [value.projects, value.reports, value.notices])
    if (new Set(records.map((r) => r.id)).size !== records.length) return fail();
  if (new Set(value.notices.map((n) => n.report_id)).size !== value.notices.length) return fail();
  return value;
}
function filtered(store: Store, user: PortalUser): HealthWorkspace {
  validateStore(store);
  const projects = store.projects.filter((p) => allowed(user, p));
  const ids = new Set(projects.map((p) => p.id));
  const notices = store.notices
    .filter((n) => ids.has(n.project_id))
    .map((n) => ({
      ...n,
      read_by: user.role === 'student' ? n.read_by.filter((id) => id === user.id) : n.read_by,
    }));
  // Students receive the level/date and approved messages, never peer evidence or drafts.
  return {
    actor_id: user.id,
    projects:
      user.role === 'student'
        ? projects.map((p) => ({ ...p, health: { ...p.health, rules: [], fingerprint: '' } }))
        : projects,
    reports: user.role === 'supervisor' ? store.reports.filter((r) => ids.has(r.project_id)) : [],
    notices,
  };
}
export function validateHealthWorkspace(data: unknown, user: PortalUser): HealthWorkspace {
  role(user);
  const value = data as HealthWorkspace;
  if (
    !value ||
    value.actor_id !== user.id ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.reports) ||
    !Array.isArray(value.notices)
  )
    throw new Error('Health response belongs to a different account or has invalid data.');
  // Validate the student projection independently: draft records are forbidden.
  if (user.role === 'student') {
    if (
      value.reports.length ||
      new Set(value.projects.map((p) => p?.id)).size !== value.projects.length ||
      new Set(value.notices.map((n) => n?.id)).size !== value.notices.length ||
      value.projects.some(
        (p) =>
          !p ||
          typeof p.id !== 'string' ||
          typeof p.name !== 'string' ||
          typeof p.title !== 'string' ||
          typeof p.supervisor_id !== 'string' ||
          typeof p.prepared !== 'boolean' ||
          !Array.isArray(p.member_ids) ||
          p.member_ids.length < 1 ||
          p.member_ids.length > 3 ||
          p.member_ids.some((id) => typeof id !== 'string') ||
          new Set(p.member_ids).size !== p.member_ids.length ||
          !allowed(user, p) ||
          !p.health ||
          !['green', 'amber', 'red'].includes(p.health.level) ||
          !Number.isFinite(Date.parse(p.health.calculated_at)) ||
          !Array.isArray(p.health.rules) ||
          p.health.rules.length ||
          p.health.fingerprint !== '',
      ) ||
      value.notices.some(
        (n) =>
          !n ||
          !value.projects.some((p) => p.id === n.project_id) ||
          typeof n.id !== 'string' ||
          typeof n.report_id !== 'string' ||
          typeof n.project_id !== 'string' ||
          typeof n.body !== 'string' ||
          n.body.length > 4000 ||
          !n.body.trim() ||
          !Array.isArray(n.read_by) ||
          n.read_by.some((id) => id !== user.id) ||
          !Number.isFinite(Date.parse(n.created_at)) ||
          !['green', 'amber', 'red'].includes(n.level),
      )
    )
      throw new Error('Private or malformed health data was returned to the student.');
    return value;
  }
  validateStore(value);
  if (value.projects.some((p) => !allowed(user, p)))
    throw new Error('Health response contains an unassigned group.');
  return value;
}
async function rpc(user: PortalUser, name: string, args?: Record<string, unknown>) {
  if (!supabase) throw new Error('The health backend is not configured.');
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw new Error(
      error.code === 'PGRST202'
        ? 'Health notices are temporarily unavailable. Please ask the coordinator to complete the health integration.'
        : 'Health request failed: ' + error.message,
    );
  return validateHealthWorkspace(data, user);
}
function preparedProject(id: string, soon: boolean, anchor: number): MilestoneProject {
  return {
    id,
    group_name: soon ? 'Team Horizon · prepared Amber' : 'Team Summit · prepared Green',
    title: 'Prepared health scenario',
    supervisor_id: 'demo-supervisor',
    members: [
      { id: 'demo-student', full_name: 'Ayesha Khan' },
      { id: 'student-farhan', full_name: 'Farhan Ahmed' },
    ],
    milestones: [
      {
        id: id + '-plan',
        name: 'Project plan',
        description: '',
        deadline: new Date(anchor + (soon ? 2 : 10) * 86400000).toISOString(),
        status: 'not_started',
        submissions: [],
      },
    ],
  };
}
async function refreshDemo(user: PortalUser): Promise<Store> {
  const actual = (await loadMilestoneWorkspace(user)).projects;
  const store = validateStore(read());
  store.demo_anchor ??= Date.now();
  const prepared = ['demo-student', 'demo-supervisor', 'student-farhan'].includes(user.id)
    ? [
        preparedProject('health-prepared-green', false, store.demo_anchor),
        preparedProject('health-prepared-amber', true, store.demo_anchor),
      ].filter((p) =>
        user.role === 'supervisor'
          ? p.supervisor_id === user.id
          : p.members.some((m) => m.id === user.id),
      )
    : [];
  for (const project of [...actual, ...prepared]) {
    const input: HealthInput = {
      project_id: project.id,
      peers_required: project.id === 'demo-milestone-project',
      peers: [],
    };
    const result = calculateHealth(project, input);
    const previous = store.projects.find((p) => p.id === project.id);
    const updated: HealthProject = {
      id: project.id,
      name: project.group_name,
      title: project.title,
      supervisor_id: project.supervisor_id,
      member_ids: project.members.map((m) => m.id),
      prepared: project.id.startsWith('health-prepared'),
      health: previous?.health.fingerprint === result.fingerprint ? previous.health : result,
    };
    store.projects = [...store.projects.filter((p) => p.id !== project.id), updated];
  }
  save(validateStore(store));
  return store;
}
export async function loadHealthWorkspace(user: PortalUser): Promise<HealthWorkspace> {
  role(user);
  return demoEnabled ? filtered(await refreshDemo(user), user) : rpc(user, 'get_health_workspace');
}
export async function recalculateHealth(user: PortalUser): Promise<HealthWorkspace> {
  if (user.role !== 'supervisor') throw new Error('Only supervisors can recalculate group health.');
  return demoEnabled ? loadHealthWorkspace(user) : rpc(user, 'calculate_group_health');
}
export async function createHealthDraft(
  user: PortalUser,
  projectId: string,
): Promise<HealthWorkspace> {
  if (user.role !== 'supervisor')
    throw new Error('Only assigned supervisors can create health drafts.');
  const workspace = await loadHealthWorkspace(user);
  const project = workspace.projects.find((p) => p.id === projectId);
  if (!project) throw new Error('This group is not assigned to you.');
  if (project.health.level === 'green')
    throw new Error('No intervention notice is needed for a Green project.');
  if (!demoEnabled) {
    if (!supabase) throw new Error('The health backend is not configured.');
    const { error } = await supabase.functions.invoke('fyp-health-agent-v2', {
      body: { project_id: projectId },
    });
    if (error) return rpc(user, 'create_group_health_fallback', { p_project_id: projectId });
    return loadHealthWorkspace(user);
  }
  const store = validateStore(read());
  if (
    store.reports.some(
      (r) =>
        r.project_id === projectId &&
        r.risk_fingerprint === project.health.fingerprint &&
        r.status === 'draft',
    )
  )
    throw new Error('A draft already exists for this health calculation.');
  const output = await generateHealthText(project.health);
  const report: HealthReport = {
    ...output,
    id: crypto.randomUUID(),
    project_id: projectId,
    risk_fingerprint: project.health.fingerprint,
    status: 'draft',
    version: 1,
    created_at: new Date().toISOString(),
    reviewed_at: null,
    reviewer_id: null,
  };
  // Re-read after asynchronous work; never overwrite a newer decision or calculation.
  const current = validateStore(read());
  if (
    current.projects.find((p) => p.id === projectId)?.health.fingerprint !==
      project.health.fingerprint ||
    current.reports.some(
      (r) =>
        r.project_id === projectId &&
        r.risk_fingerprint === project.health.fingerprint &&
        r.status === 'draft',
    )
  )
    throw new Error('Health changed or a draft already exists. Refresh and retry.');
  current.reports.push(report);
  save(current);
  return filtered(current, user);
}
export async function reviewHealthDraft(
  user: PortalUser,
  reportId: string,
  version: number,
  action: 'approve' | 'reject',
  text: HealthText,
): Promise<HealthWorkspace> {
  if (user.role !== 'supervisor')
    throw new Error('Only assigned supervisors can review health drafts.');
  if (!['approve', 'reject'].includes(action)) throw new Error('Choose a valid review action.');
  const edited = validateHealthText(text);
  const workspace = await loadHealthWorkspace(user);
  const report = workspace.reports.find((r) => r.id === reportId);
  const project = workspace.projects.find((p) => p.id === report?.project_id);
  if (!report || !project || report.status !== 'draft' || report.version !== version)
    throw new Error('This draft changed or was already reviewed. Refresh before continuing.');
  if (report.risk_fingerprint !== project.health.fingerprint)
    throw new Error(
      'Health evidence changed. Generate a fresh draft before approving or rejecting this one.',
    );
  if (!demoEnabled)
    return rpc(user, 'review_group_health', {
      p_report_id: reportId,
      p_expected_version: version,
      p_action: action,
      p_explanation: edited.explanation,
      p_recommended_action: edited.action,
      p_message: edited.message,
    });
  const store = validateStore(read());
  const currentReport = store.reports.find((r) => r.id === reportId);
  if (
    !currentReport ||
    currentReport.status !== 'draft' ||
    currentReport.version !== version ||
    store.projects.find((p) => p.id === report.project_id)?.health.fingerprint !==
      report.risk_fingerprint
  )
    throw new Error('This draft changed or was already reviewed. Refresh before continuing.');
  const now = new Date().toISOString();
  const updated: HealthReport = {
    ...report,
    ...edited,
    status: action === 'approve' ? 'approved' : 'rejected',
    version: version + 1,
    reviewed_at: now,
    reviewer_id: user.id,
  };
  store.reports = store.reports.map((r) => (r.id === reportId ? updated : r));
  if (action === 'approve')
    store.notices.push({
      id: crypto.randomUUID(),
      report_id: reportId,
      project_id: project.id,
      body: edited.message,
      level: project.health.level,
      created_at: now,
      read_by: [],
    });
  save(validateStore(store));
  return filtered(store, user);
}
export async function markHealthNoticeRead(
  user: PortalUser,
  noticeId: string,
): Promise<HealthWorkspace> {
  if (user.role !== 'student') throw new Error('Only notice recipients can mark a notice as read.');
  const workspace = await loadHealthWorkspace(user);
  if (!workspace.notices.some((n) => n.id === noticeId))
    throw new Error('This notice is not available to your group.');
  if (!demoEnabled) return rpc(user, 'mark_health_notice_read', { p_notice_id: noticeId });
  const store = validateStore(read());
  store.notices = store.notices.map((n) =>
    n.id === noticeId ? { ...n, read_by: [...new Set([...n.read_by, user.id])] } : n,
  );
  save(validateStore(store));
  return filtered(store, user);
}
