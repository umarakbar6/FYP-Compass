import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock3, Flag, FileCheck2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Button, DataTable, EmptyState, StatisticCard } from '../components/ui';
import { latestSubmission } from '../lib/milestone-api';
import { useMilestones } from './MilestoneProvider';
import { dateLabel, MilestoneBadge, TimingBadge, MilestoneDataMode, MilestoneGate } from './common';
export function MilestoneList() {
  const { user } = useAuth();
  const { workspace, loading, error, refresh } = useMilestones();
  const [filter, setFilter] = useState('all');
  if (loading || error || !workspace) return <MilestoneGate />;
  const all = workspace.projects.flatMap((project) =>
    project.milestones.map((item) => ({ project, item })),
  );
  const rows = all.filter(({ item }) => filter === 'all' || item.status === filter);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {user?.role === 'student' ? 'STUDENT MILESTONES' : 'SUPERVISOR MILESTONE REVIEWS'}
          </span>
          <h1>
            {user?.role === 'student'
              ? 'Turn progress into evidence.'
              : 'Review progress. Guide the next step.'}
          </h1>
          <p>Deadlines, submission evidence, and individual contributions in one place.</p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()}>
          Refresh milestones
        </Button>
      </div>
      <MilestoneDataMode />
      <div className="stats-grid">
        <StatisticCard
          label="Total milestones"
          value={String(all.length)}
          detail={`${workspace.projects.length} approved projects`}
          icon={Flag}
        />
        <StatisticCard
          label="Awaiting review"
          value={String(all.filter((r) => r.item.status === 'submitted').length)}
          detail="Submitted evidence"
          icon={FileCheck2}
        />
        <StatisticCard
          label="Needs rework"
          value={String(all.filter((r) => r.item.status === 'needs_rework').length)}
          detail="Feedback to address"
          icon={Clock3}
        />
        <StatisticCard
          label="Accepted"
          value={String(all.filter((r) => r.item.status === 'accepted').length)}
          detail="Reviewed milestones"
          icon={CheckCircle2}
        />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Project milestones</h2>
          <label className="milestone-filter">
            Workflow status
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="not_started">Not started</option>
              <option value="submitted">Submitted</option>
              <option value="needs_rework">Needs rework</option>
              <option value="accepted">Accepted</option>
            </select>
          </label>
        </div>
        <p className="form-hint">
          Workflow status tracks review. Timing compares the latest submission with its deadline; an
          unsubmitted milestone becomes Overdue after the deadline.
        </p>
        {!all.length ? (
          <EmptyState
            title="Your milestone plan is not ready yet"
            description="An approved project and coordinator milestone templates are required. Refresh after approval."
          />
        ) : (
          <DataTable
            caption="Project milestone directory"
            rows={rows}
            rowKey={(r) => r.item.id}
            columns={[
              {
                key: 'name',
                label: 'Milestone',
                render: (r) => (
                  <div>
                    <Link className="text-link" to={`/${user?.role}/milestones/${r.item.id}`}>
                      {r.item.name} →
                    </Link>
                    <small className="milestone-table-sub">{r.project.group_name}</small>
                  </div>
                ),
              },
              {
                key: 'deadline',
                label: 'Deadline (PKT)',
                render: (r) => dateLabel(r.item.deadline),
              },
              { key: 'status', label: 'Workflow', render: (r) => <MilestoneBadge item={r.item} /> },
              { key: 'timing', label: 'Timing', render: (r) => <TimingBadge item={r.item} /> },
              {
                key: 'evidence',
                label: 'Contributions',
                render: (r) =>
                  `${latestSubmission(r.item)?.contributions.length || 0} / ${r.project.members.length}`,
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
