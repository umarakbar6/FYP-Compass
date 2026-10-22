export type HealthLevel = 'green' | 'amber' | 'red';
export interface PeerSignal {
  member_id: string;
  ratings: number[];
  supervisor_percent: number | null;
}
export interface HealthInput {
  project_id: string;
  peers_required: boolean;
  peers: PeerSignal[];
}
export interface HealthRule {
  code: string;
  level: 'amber' | 'red';
  evidence: string;
}
export interface HealthResult {
  level: HealthLevel;
  rules: HealthRule[];
  calculated_at: string;
  fingerprint: string;
}
export interface HealthText {
  explanation: string;
  action: string;
  message: string;
}
export interface HealthReport extends HealthText {
  id: string;
  project_id: string;
  risk_fingerprint: string;
  source: 'gemini' | 'fallback';
  status: 'draft' | 'approved' | 'rejected';
  version: number;
  created_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
}
export interface HealthProject {
  id: string;
  name: string;
  title: string;
  supervisor_id: string;
  member_ids: string[];
  health: HealthResult;
  prepared: boolean;
}
export interface HealthNotice {
  id: string;
  report_id: string;
  project_id: string;
  body: string;
  level: HealthLevel;
  created_at: string;
  read_by: string[];
}
export interface HealthWorkspace {
  actor_id: string;
  projects: HealthProject[];
  reports: HealthReport[];
  notices: HealthNotice[];
}
