import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StudentDashboard } from '../student/StudentDashboard';
vi.mock('../lib/backend-version', () => ({ coreV2: true }));
vi.mock('../student/StudentProvider', () => ({
  useStudent: () => ({
    loading: false,
    error: '',
    workspace: { group: { id: 'active-group', name: 'Current team', members: [] }, proposal: null },
  }),
}));
vi.mock('../health/HealthProvider', () => ({
  useHealth: () => ({
    workspace: {
      projects: [
        { id: 'archived-group', prepared: false, health: { level: 'red' } },
        { id: 'active-group', prepared: false, health: { level: 'green' } },
      ],
    },
  }),
}));
vi.mock('../milestones/MilestoneProvider', () => ({
  useMilestones: () => ({ workspace: { projects: [] } }),
}));
vi.mock('../health/NoticesPage', () => ({ HealthDashboardSummary: () => null }));
vi.mock('../milestones/common', () => ({ MilestoneDashboardSummary: () => null }));
vi.mock('../student/ProposalPage', () => ({ AllocationView: () => null }));
vi.mock('../student/common', () => ({
  WorkspaceGate: () => null,
  DataMode: () => null,
  ProposalBadge: () => null,
}));
it('shows the current group health even when an archived Red project appears first', () => {
  render(
    <MemoryRouter>
      <StudentDashboard />
    </MemoryRouter>,
  );
  expect(screen.getByText('GREEN')).toBeInTheDocument();
  expect(screen.queryByText('RED')).not.toBeInTheDocument();
});
