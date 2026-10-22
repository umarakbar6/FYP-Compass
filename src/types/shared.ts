// Shared MVP vocabulary. Coordinate changes with both members.
export const roles = ['student', 'supervisor', 'examiner', 'coordinator'] as const;
export type Role = (typeof roles)[number];
export type ProposalStatus =
  'draft' | 'submitted' | 'changes_requested' | 'approved' | 'rejected' | 'withdrawn';
export type MilestoneStatus = 'not_started' | 'submitted' | 'needs_rework' | 'accepted';
export type TimingStatus = 'on_time' | 'late' | 'overdue';
export type HealthLevel = 'green' | 'amber' | 'red';
export interface Profile {
  id: string;
  full_name: string;
  role: Role;
}
export interface PortalUser extends Profile {
  email: string;
}
export const isRole = (value: unknown): value is Role => roles.includes(value as Role);
export const dashboardPath = (role: Role) => `/${role}/dashboard`;
export const roleLabel: Record<Role, string> = {
  student: 'Student',
  supervisor: 'Supervisor',
  examiner: 'Examiner',
  coordinator: 'Coordinator',
};
