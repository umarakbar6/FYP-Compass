import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button, EmptyState, ErrorMessage, LoadingState, StatusBadge } from '../components/ui';
import { demoEnabled } from '../lib/supabase';
import { latestSubmission, milestoneTiming } from '../lib/milestone-api';
import type { Milestone } from '../types/milestone';
import { useMilestones } from './MilestoneProvider';
export const milestoneLabels = {
  not_started: 'Not started',
  submitted: 'Submitted',
  needs_rework: 'Needs rework',
  accepted: 'Accepted',
};
export function MilestoneBadge({ item }: { item: Milestone }) {
  return (
    <StatusBadge
      tone={
        item.status === 'accepted' ? 'green' : item.status === 'needs_rework' ? 'amber' : 'neutral'
      }
    >
      {milestoneLabels[item.status]}
    </StatusBadge>
  );
}
export function TimingBadge({ item }: { item: Milestone }) {
  const timing = milestoneTiming(item);
  return timing ? (
    <StatusBadge tone={timing === 'on_time' ? 'green' : timing === 'late' ? 'amber' : 'red'}>
      {timing === 'on_time' ? 'On Time' : timing === 'late' ? 'Late' : 'Overdue'}
    </StatusBadge>
  ) : (
    <span className="form-hint">Not due yet</span>
  );
}
export const dateLabel = (value: string) =>
  new Date(value).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function MilestoneDataMode() {
  return (
    <div className="phase-data-note">
      {demoEnabled
        ? 'Prepared approved project · Phase 4 student and supervisor demos share milestone records in this browser. This sample is separate from Phase 2 and 3 projects until integration. File contents are not stored in the demo.'
        : 'Connected milestones · deadlines, submissions, and feedback come from your assigned projects.'}
    </div>
  );
}
export function MilestoneGate() {
  const { loading, error, workspace, refresh } = useMilestones();
  return loading ? (
    <LoadingState label="Loading milestones…" />
  ) : error || !workspace ? (
    <>
      <ErrorMessage message={error || 'Milestones are unavailable.'} />
      <Button onClick={() => void refresh()}>Retry milestones</Button>
    </>
  ) : null;
}
export function MilestoneDashboardSummary() {
  const { user } = useAuth();
  const { workspace, loading, error, refresh } = useMilestones();
  return (
    <section className="panel milestone-dashboard">
      <div className="panel-heading">
        <h2>{user?.role === 'student' ? 'Milestones and feedback' : 'Milestone review queue'}</h2>
        <Link className="text-link" to={`/${user?.role}/milestones`}>
          Open milestones →
        </Link>
      </div>
      {loading || error || !workspace ? (
        <MilestoneGate />
      ) : !workspace.projects.length ? (
        <EmptyState
          title="No approved project yet"
          description="Milestones become available after proposal approval and template creation."
        />
      ) : (
        <>
          <p className="form-hint">
            {demoEnabled
              ? 'Prepared Phase 4 project; separate from your proposal demo.'
              : 'Latest milestone records from your projects.'}
          </p>
          <div className="milestone-summary-list">
            {workspace.projects
              .flatMap((project) => project.milestones.map((item) => ({ project, item })))
              .map(({ project, item }) => {
                const entry = latestSubmission(item);
                return (
                  <Link
                    key={item.id}
                    to={`/${user?.role}/milestones/${item.id}`}
                    className="milestone-summary-item"
                  >
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {project.group_name} · {dateLabel(item.deadline)}
                      </small>
                      {entry?.review && <p>{entry.review.feedback || 'Milestone accepted.'}</p>}
                    </div>
                    <div className="milestone-badges">
                      <MilestoneBadge item={item} />
                      <TimingBadge item={item} />
                    </div>
                  </Link>
                );
              })}
          </div>
          <Button variant="ghost" onClick={() => void refresh()}>
            Refresh milestone feedback
          </Button>
        </>
      )}
    </section>
  );
}
