import type { Profile, ProposalStatus } from './shared';
export interface Topic {
  id: string;
  name: string;
}
export interface Supervisor {
  id: string;
  full_name: string;
  topics: string[];
}
export interface StudentGroup {
  id: string;
  name: string;
  session_id: string;
  members: Profile[];
}
export interface ProposalDocument {
  name: string;
  path: string | null;
  size: number;
}
export interface StudentProposal {
  id: string;
  group_id: string;
  title: string;
  abstract: string;
  keywords: string[];
  topic_ids: string[];
  supervisor_ids: string[];
  status: ProposalStatus;
  document: ProposalDocument | null;
  submitted_at: string | null;
  feedback: string | null;
}
export interface Allocation {
  supervisor_id: string;
  supervisor_name: string;
  preference_rank: number | null;
  explanation: string;
}
export interface StudentWorkspace {
  session: { id: string; name: string } | null;
  topics: Topic[];
  supervisors: Supervisor[];
  eligible_members: Profile[];
  group: StudentGroup | null;
  proposal: StudentProposal | null;
  allocation: Allocation | null;
}
export interface ProposalInput {
  title: string;
  abstract: string;
  keywords: string[];
  topic_ids: string[];
  supervisor_ids: string[];
}
