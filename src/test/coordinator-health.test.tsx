import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoordinatorHealth, loadCoordinatorHealth } from '../health/CoordinatorHealth';
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: {
    id: 'coordinator',
    role: 'coordinator',
    full_name: 'Coordinator',
    email: 'c@example.test',
  },
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
const workspace = () => ({
  actor_id: 'coordinator',
  selected_session: 'current',
  sessions: [
    { id: 'current', name: 'Current', active: true },
    { id: 'archive', name: 'Archive', active: false },
  ],
  projects: [
    {
      id: 'group',
      name: 'Active team',
      title: 'Active project',
      supervisor_name: 'Supervisor',
      draft_count: 1,
      health: { level: 'green', rules: [], calculated_at: '2026-10-10T10:00:00Z' },
    },
  ],
  notices: [
    {
      id: 'notice',
      project_name: 'Active team',
      body: 'Approved supportive message',
      level: 'amber',
      source: 'gemini',
      created_at: '2026-10-10T10:00:00Z',
      recipients_count: 3,
      read_count: 1,
    },
  ],
});
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: workspace(), error: null });
});
it('shows coordinator health oversight instead of the accreditation report without AI decision controls', async () => {
  render(<CoordinatorHealth />);
  expect(await screen.findByText('No health rules triggered.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Project health oversight' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Accreditation report' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Approve|Create draft/ })).not.toBeInTheDocument();
});
it('shows approved notices with delivery counts rather than replacing notifications with reports', async () => {
  render(<CoordinatorHealth notices />);
  expect(await screen.findByText('Approved supportive message')).toBeInTheDocument();
  expect(screen.getByText('1 of 3 recipients have read this notice.')).toBeInTheDocument();
  expect(screen.queryByText('No health rules triggered.')).not.toBeInTheDocument();
});
it('reloads the selected session and represents an empty archived session accurately', async () => {
  render(<CoordinatorHealth notices />);
  await screen.findByText('Approved supportive message');
  mocks.rpc.mockResolvedValue({
    data: { ...workspace(), selected_session: 'archive', projects: [], notices: [] },
    error: null,
  });
  await userEvent.selectOptions(screen.getByRole('combobox'), 'archive');
  expect(await screen.findByText('No published notices in this session')).toBeInTheDocument();
  expect(mocks.rpc).toHaveBeenLastCalledWith('fyp_coordinator_health', { p_session_id: 'archive' });
});
it('rejects other roles before calling the database and rejects data for a different actor', async () => {
  await expect(
    loadCoordinatorHealth({ ...mocks.user, role: 'student' } as never, null),
  ).rejects.toThrow('Coordinator access required');
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: { ...workspace(), actor_id: 'another' }, error: null });
  await expect(loadCoordinatorHealth(mocks.user as never, null)).rejects.toThrow(
    'could not be read',
  );
});
