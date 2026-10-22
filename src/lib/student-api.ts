import { verifyUploadedDocument } from './verify-document';
import { rpcName, submissionBucket } from './backend-version';
import { demoEnabled, supabase } from './supabase';
import type { PortalUser } from '../types/shared';
import type {
  ProposalInput,
  StudentWorkspace,
  StudentProposal,
  ProposalDocument,
} from '../types/student';
const bucket = submissionBucket;
const storageKey = (user: PortalUser) => `fyp-compass.student.v1.${user.id}`;
export function initialWorkspace(): StudentWorkspace {
  return {
    session: { id: 'demo-session', name: 'Final Year Projects · Demo Session' },
    topics: [
      { id: 'web', name: 'Web Development' },
      { id: 'data', name: 'Data Science' },
      { id: 'ai', name: 'Artificial Intelligence' },
      { id: 'security', name: 'Cybersecurity' },
      { id: 'iot', name: 'Internet of Things' },
    ],
    supervisors: [
      {
        id: 'supervisor-ahmed',
        full_name: 'Dr. Ahmed Ali',
        topics: ['Web Development', 'Artificial Intelligence'],
      },
      {
        id: 'supervisor-sara',
        full_name: 'Dr. Sara Malik',
        topics: ['Data Science', 'Artificial Intelligence'],
      },
      {
        id: 'supervisor-hassan',
        full_name: 'Dr. Hassan Raza',
        topics: ['Cybersecurity', 'Web Development'],
      },
      { id: 'supervisor-usman', full_name: 'Dr. Usman Tariq', topics: ['Internet of Things'] },
    ],
    eligible_members: [
      { id: 'student-farhan', full_name: 'Farhan Ahmed', role: 'student' },
      { id: 'student-zain', full_name: 'Zain Abbas', role: 'student' },
      { id: 'student-ali', full_name: 'Ali Raza', role: 'student' },
    ],
    group: null,
    proposal: null,
    allocation: null,
  };
}
function checkStudent(user: PortalUser) {
  if (user.role !== 'student') throw new Error('Only students can use this workspace.');
}
function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}
function saveLocal(user: PortalUser, workspace: StudentWorkspace) {
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(workspace));
  } catch {
    throw new Error(
      'Your browser could not save the demo. Free some storage or enable local storage and retry.',
    );
  }
  return workspace;
}
export function validateWorkspace(data: unknown, user: PortalUser): StudentWorkspace {
  const value = data as StudentWorkspace | null;
  const invalid = () => {
    throw new Error('The workspace response is invalid. Check the Phase 2 backend contract.');
  };
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) && items.every((item) => typeof item === 'string');
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.topics) ||
    !Array.isArray(value.supervisors) ||
    !Array.isArray(value.eligible_members) ||
    !('session' in value) ||
    !('group' in value) ||
    !('proposal' in value) ||
    !('allocation' in value)
  )
    return invalid();
  if (
    value.session !== null &&
    (!value.session ||
      typeof value.session.id !== 'string' ||
      typeof value.session.name !== 'string')
  )
    return invalid();
  if (
    !value.topics.every(
      (item) => item && typeof item.id === 'string' && typeof item.name === 'string',
    )
  )
    return invalid();
  if (
    !value.supervisors.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.full_name === 'string' &&
        strings(item.topics),
    )
  )
    return invalid();
  const profiles = (items: unknown): boolean =>
    Array.isArray(items) &&
    items.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.full_name === 'string' &&
        item.role === 'student',
    );
  if (!profiles(value.eligible_members)) return invalid();
  if (
    value.group !== null &&
    (!value.group ||
      typeof value.group.id !== 'string' ||
      typeof value.group.name !== 'string' ||
      typeof value.group.session_id !== 'string' ||
      !profiles(value.group.members) ||
      value.group.members.length < 1 ||
      value.group.members.length > 3)
  )
    return invalid();
  if (
    value.group &&
    (new Set(value.group.members.map((member) => member.id)).size !== value.group.members.length ||
      !value.group.members.some((member) => member.id === user.id))
  )
    return invalid();
  const proposal = value.proposal;
  if (
    proposal !== null &&
    (!proposal ||
      typeof proposal.id !== 'string' ||
      typeof proposal.group_id !== 'string' ||
      typeof proposal.title !== 'string' ||
      typeof proposal.abstract !== 'string' ||
      !strings(proposal.keywords) ||
      !strings(proposal.topic_ids) ||
      !strings(proposal.supervisor_ids) ||
      proposal.supervisor_ids.length !== 3 ||
      !['draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn'].includes(
        proposal.status,
      ) ||
      (proposal.feedback !== null && typeof proposal.feedback !== 'string') ||
      (proposal.submitted_at !== null && typeof proposal.submitted_at !== 'string'))
  )
    return invalid();
  if (
    proposal &&
    proposal.document !== null &&
    (!proposal.document ||
      typeof proposal.document.name !== 'string' ||
      !Number.isFinite(proposal.document.size) ||
      proposal.document.size <= 0 ||
      proposal.document.size > 10 * 1024 * 1024 ||
      (proposal.document.path !== null && typeof proposal.document.path !== 'string'))
  )
    return invalid();
  if (
    value.allocation !== null &&
    (!value.allocation ||
      typeof value.allocation.supervisor_id !== 'string' ||
      typeof value.allocation.supervisor_name !== 'string' ||
      typeof value.allocation.explanation !== 'string' ||
      (value.allocation.preference_rank !== null &&
        ![1, 2, 3].includes(value.allocation.preference_rank)))
  )
    return invalid();
  if (proposal && (!value.group || proposal.group_id !== value.group.id)) return invalid();
  return value;
}
async function rpc(
  user: PortalUser,
  name: string,
  args?: Record<string, unknown>,
): Promise<StudentWorkspace> {
  const { data, error } = await requireClient().rpc(rpcName(name), args);
  if (error)
    throw new Error(
      `Could not save or load your workspace: ${error.message}. If setup is pending, check the Phase 2 backend handoff.`,
    );
  return validateWorkspace(data, user);
}
export async function loadWorkspace(user: PortalUser): Promise<StudentWorkspace> {
  checkStudent(user);
  if (!demoEnabled) return rpc(user, 'get_student_workspace');
  let stored: string | null;
  try {
    stored = localStorage.getItem(storageKey(user));
  } catch {
    throw new Error('Local demo storage is unavailable in this browser.');
  }
  if (!stored) return initialWorkspace();
  try {
    return validateWorkspace(JSON.parse(stored), user);
  } catch {
    throw new Error(
      'Saved demo data could not be read. Clear this site’s local demo storage to start again.',
    );
  }
}
export function validateGroup(workspace: StudentWorkspace, memberIds: string[], name: string) {
  if (workspace.group) throw new Error('You already belong to an active group.');
  if (!workspace.session)
    throw new Error('The coordinator must configure an active session first.');
  if (!name.trim()) throw new Error('Enter a group name.');
  if (memberIds.length > 2 || new Set(memberIds).size !== memberIds.length)
    throw new Error('A group can contain one to three different students, including you.');
  if (memberIds.some((id) => !workspace.eligible_members.some((member) => member.id === id)))
    throw new Error('Choose only available students from this session.');
}
export async function createGroup(user: PortalUser, name: string, memberIds: string[]) {
  const workspace = await loadWorkspace(user);
  validateGroup(workspace, memberIds, name);
  if (!demoEnabled)
    return rpc(user, 'create_student_group', {
      p_name: name.trim(),
      p_session_id: workspace.session!.id,
      p_member_ids: memberIds,
    });
  const members = [
    user,
    ...workspace.eligible_members.filter((member) => memberIds.includes(member.id)),
  ];
  return saveLocal(user, {
    ...workspace,
    group: {
      id: crypto.randomUUID(),
      name: name.trim(),
      session_id: workspace.session!.id,
      members,
    },
    eligible_members: workspace.eligible_members.filter((member) => !memberIds.includes(member.id)),
  });
}
export function canEditProposal(proposal: StudentProposal | null) {
  return (
    !proposal || ['draft', 'changes_requested', 'rejected', 'withdrawn'].includes(proposal.status)
  );
}
export function validateProposal(
  workspace: StudentWorkspace,
  input: ProposalInput,
  submit: boolean,
) {
  if (!workspace.group) throw new Error('Create your group before preparing a proposal.');
  if (!canEditProposal(workspace.proposal))
    throw new Error('Your active proposal is already submitted or approved.');
  if (input.topic_ids.length > 3 || new Set(input.topic_ids).size !== input.topic_ids.length)
    throw new Error('Choose up to three different topic tags.');
  if (input.topic_ids.some((id) => !workspace.topics.some((topic) => topic.id === id)))
    throw new Error('Choose topic tags from the controlled list.');
  const selected = input.supervisor_ids.filter(Boolean);
  if (input.supervisor_ids.length !== 3 || new Set(selected).size !== selected.length)
    throw new Error('Supervisor preferences must be different.');
  if (selected.some((id) => !workspace.supervisors.some((supervisor) => supervisor.id === id)))
    throw new Error('Choose supervisors from the available list.');
  if (
    submit &&
    (!input.title.trim() ||
      !input.abstract.trim() ||
      !input.keywords.length ||
      selected.length !== 3)
  )
    throw new Error(
      'Add a title, abstract, keywords, and three different ranked supervisors before submitting.',
    );
}
export async function saveProposal(
  user: PortalUser,
  input: ProposalInput,
  file: File | null,
  submit: boolean,
) {
  const workspace = await loadWorkspace(user);
  validateProposal(workspace, input, submit);
  if (file && (!/\.(pdf|docx)$/i.test(file.name) || file.size <= 0 || file.size > 10 * 1024 * 1024))
    throw new Error('Choose a PDF or DOCX file with content, no larger than 10 MB.');
  let document: ProposalDocument | null = workspace.proposal?.document || null;
  if (file) {
    if (demoEnabled) document = { name: file.name, size: file.size, path: null };
    else {
      const path = `${user.id}/${workspace.group!.id}/${crypto.randomUUID()}.${file.name.split('.').pop()!.toLowerCase()}`;
      const { error } = await requireClient()
        .storage.from(bucket)
        .upload(path, file, { upsert: false });
      if (error) throw new Error(`Document upload failed: ${error.message}`);
      await verifyUploadedDocument(path, file.name);
      document = { name: file.name, size: file.size, path };
    }
  }
  if (!demoEnabled) {
    // A transport error can happen after the database commits. Never delete a
    // newly uploaded file on an ambiguous failure; the backend can clean up
    // genuinely unreferenced uploads later.
    return rpc(user, 'save_student_proposal', {
      p_group_id: workspace.group!.id,
      p_title: input.title.trim(),
      p_abstract: input.abstract.trim(),
      p_keywords: input.keywords,
      p_topic_ids: input.topic_ids,
      p_supervisor_ids: input.supervisor_ids.map((id) => id || null),
      p_document: document,
      p_submit: submit,
    });
  }
  const reuse =
    workspace.proposal && ['draft', 'changes_requested'].includes(workspace.proposal.status);
  return saveLocal(user, {
    ...workspace,
    proposal: {
      ...input,
      title: input.title.trim(),
      abstract: input.abstract.trim(),
      id: reuse ? workspace.proposal!.id : crypto.randomUUID(),
      group_id: workspace.group!.id,
      status: submit ? 'submitted' : 'draft',
      document,
      submitted_at: submit ? new Date().toISOString() : null,
      feedback: workspace.proposal?.feedback || null,
    },
  });
}
export async function documentUrl(document: ProposalDocument): Promise<string> {
  if (!document.path)
    throw new Error(
      'The local demo stores file details only. File downloads require connected Supabase Storage.',
    );
  const { data, error } = await requireClient()
    .storage.from(bucket)
    .createSignedUrl(document.path, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
