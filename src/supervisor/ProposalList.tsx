import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { DataTable, StatusBadge } from '../components/ui';
import { ProposalBadge } from '../student/common';
import { useSupervisor } from './SupervisorProvider';
import { SupervisorGate, SupervisorDataMode, dateLabel } from './common';
export function ProposalList({ groups = false }: { groups?: boolean }) {
  const { workspace, loading, error } = useSupervisor();
  const [filter, setFilter] = useState('submitted');
  const [search, setSearch] = useState('');
  if (loading || error || !workspace) return <SupervisorGate />;
  const rows = workspace.proposals.filter(
    (item) =>
      (groups || filter === 'all' || item.status === filter) &&
      `${item.title} ${item.group_name} ${item.members.map((member) => member.full_name).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            SUPERVISOR / {groups ? 'ALLOCATED GROUPS' : 'PROPOSAL REVIEWS'}
          </span>
          <h1>{groups ? 'Know your project teams.' : 'A clear decision starts here.'}</h1>
          <p>
            {groups
              ? `${workspace.proposals.length} allocated groups · capacity ${workspace.capacity}`
              : 'Read the proposal, inspect similarity evidence, and give a considered review.'}
          </p>
        </div>
        <StatusBadge>Phase 3</StatusBadge>
      </div>
      <SupervisorDataMode />
      <section className="panel">
        <div className="review-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search proposals and groups"
              placeholder="Search title, group or student…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {!groups && (
            <select
              aria-label="Filter proposal status"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="submitted">Awaiting review</option>
              <option value="all">All proposals</option>
              <option value="approved">Approved</option>
              <option value="changes_requested">Changes requested</option>
              <option value="rejected">Rejected</option>
            </select>
          )}
        </div>
        <DataTable
          caption={groups ? 'Allocated group directory' : 'Proposal review queue'}
          rows={rows}
          rowKey={(item) => item.id}
          columns={[
            {
              key: 'group',
              label: 'Group and members',
              render: (item) => (
                <div className="table-group">
                  <strong>{item.group_name}</strong>
                  <small>{item.members.map((member) => member.full_name).join(', ')}</small>
                </div>
              ),
            },
            {
              key: 'title',
              label: 'Project',
              render: (item) => (
                <div className="table-title">
                  {item.title}
                  <small>Submitted {dateLabel(item.submitted_at)}</small>
                </div>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: (item) => <ProposalBadge status={item.status} />,
            },
            {
              key: 'similarity',
              label: 'Similarity',
              render: (item) => (
                <StatusBadge tone={item.similarity.status === 'flagged' ? 'amber' : 'neutral'}>
                  {item.similarity.percentage === null
                    ? 'Pending'
                    : `${item.similarity.percentage}%${item.similarity.status === 'flagged' ? ' · flagged' : ''}`}
                </StatusBadge>
              ),
            },
            {
              key: 'action',
              label: 'Details',
              render: (item) => (
                <Link className="text-link" to={`/supervisor/proposals/${item.id}`}>
                  {item.status === 'submitted' ? 'Review proposal' : 'View details'}
                  <ArrowRight size={15} />
                </Link>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
