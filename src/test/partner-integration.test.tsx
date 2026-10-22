import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ConnectedModule, validateModuleData } from '../pages/ConnectedModule';
import type { PortalUser } from '../types/shared';
const live = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: {
    id: 'coordinator-a',
    role: 'coordinator',
    full_name: 'Coordinator',
    email: 'test@example.test',
  } as PortalUser | null,
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: live.user }) }));
vi.mock('../lib/supabase', () => ({ demoEnabled: false, supabase: { rpc: live.rpc } }));
function Harness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/coordinator/reports')}>Open reports</button>
      <ConnectedModule />
    </>
  );
}
function open(path = '/coordinator/configuration') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  live.user = {
    id: 'coordinator-a',
    role: 'coordinator',
    full_name: 'Coordinator',
    email: 'test@example.test',
  };
  live.rpc.mockResolvedValue({ data: { items: [], sessions: [], capacities: [] }, error: null });
});
it.each([
  null,
  [],
  { items: [null] },
  { items: [1] },
  { sessions: {} },
  { capacities: 'bad' },
  { drafts: [null] },
  { dashboard: [] },
])('rejects a malformed partner response: %j', (value) => {
  expect(() => validateModuleData(value)).toThrow();
});
it('renders empty configuration safely and shows a status only after loading', async () => {
  open();
  expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
  expect(screen.getByText('Loaded')).toBeInTheDocument();
  expect(screen.getAllByText('No records yet')).toHaveLength(2);
});
it('shows a plain Supabase error with retry and never labels failure as connected', async () => {
  live.rpc.mockResolvedValue({
    data: null,
    error: { message: 'Not authorized for this session', code: '42501' },
  });
  open();
  expect(await screen.findByText('Not authorized for this session')).toBeInTheDocument();
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  live.rpc.mockResolvedValue({ data: { sessions: [], capacities: [] }, error: null });
  await userEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
  expect(await screen.findByText('Loaded')).toBeInTheDocument();
});
it('ignores an old route response after reports are loaded', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  live.rpc.mockImplementation((_name, args) =>
    args.p_module === 'configuration'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({
          data: {
            dashboard: { submitted_groups: 7 },
            accreditation: { session: 'Current session' },
          },
          error: null,
        }),
  );
  open();
  await userEvent.click(screen.getByRole('button', { name: 'Open reports' }));
  expect(await screen.findByText('Current session')).toBeInTheDocument();
  await act(async () => {
    resolveOld({ data: { sessions: [{ name: 'Stale private session' }] }, error: null });
  });
  expect(screen.queryByText('Stale private session')).not.toBeInTheDocument();
  expect(screen.getByText('Current session')).toBeInTheDocument();
});
it('never restores the previous account response after an account switch', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  live.rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const view = open();
  live.user = { ...live.user!, id: 'coordinator-b' };
  view.rerender(
    <MemoryRouter initialEntries={['/coordinator/configuration']}>
      <Harness />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Loaded')).toBeInTheDocument();
  await act(async () => {
    resolveOld({
      data: { sessions: [{ name: 'Account A private session' }], capacities: [] },
      error: null,
    });
  });
  expect(screen.queryByText('Account A private session')).not.toBeInTheDocument();
});
it('prints the accreditation report using the current returned totals', async () => {
  live.rpc.mockResolvedValue({
    data: {
      dashboard: { submitted_groups: 7 },
      accreditation: { session: '2026', student_total: 21 },
    },
    error: null,
  });
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  open('/coordinator/reports');
  expect(await screen.findByText('21')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Print accreditation report' }));
  expect(print).toHaveBeenCalledOnce();
  print.mockRestore();
});
it('shows health snapshots without allowing manually invented health colours', async () => {
  live.rpc.mockResolvedValue({
    data: { items: [], health_results: [{ group_name: 'Team One', health_status: 'red' }] },
    error: null,
  });
  open('/coordinator/health');
  expect(await screen.findByText('Team One')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save health report' })).not.toBeInTheDocument();
});
it('keeps coordinator drafts visible without bypassing supervisor approval', async () => {
  live.rpc.mockResolvedValue({
    data: { items: [], drafts: [{ id: 'draft-1', body: 'Review this draft', status: 'draft' }] },
    error: null,
  });
  open('/coordinator/notices');
  expect(await screen.findByText('Review this draft')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
});
it('deduplicates matching clicks while the server request is pending', async () => {
  let resolveAction: (value: unknown) => void = () => {};
  live.rpc.mockImplementation((name) =>
    name === 'fyp_auto_allocate'
      ? new Promise((resolve) => {
          resolveAction = resolve;
        })
      : Promise.resolve({
          data: { items: [{ proposal_id: 'p1', title: 'Campus portal', allocated: false }] },
          error: null,
        }),
  );
  open('/coordinator/matching');
  await userEvent.click(await screen.findByRole('button', { name: 'Auto allocate' }));
  expect(screen.getByRole('button', { name: 'Auto allocate' })).toBeDisabled();
  expect(live.rpc.mock.calls.filter((call) => call[0] === 'fyp_auto_allocate')).toHaveLength(1);
  await act(async () => resolveAction({ data: null, error: null }));
});
