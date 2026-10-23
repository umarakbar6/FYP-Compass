import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReportExplorer } from '../operations/ReportExplorer';

const live = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: live, demoEnabled: false }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'coordinator-a', role: 'coordinator', full_name: 'Coordinator' } }),
}));
vi.mock('../core/CorePages', () => ({
  ReportsPage: () => <h1>Complete printable report fixture</h1>,
}));

const page = {
  session_id: 'session-a',
  sessions: [{ id: 'session-a', name: 'Academic session' }],
  rows: [],
  total: 0,
  has_more: false,
  sql_totals: { groups: 0 },
};
function view(path = '/coordinator/reports') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReportExplorer />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  live.rpc.mockReset();
  live.rpc.mockResolvedValue({ data: page, error: null });
});

it('connects the paginated summary to the full printable view with its selected session', async () => {
  view();
  const link = await screen.findByRole('link', { name: 'Open full printable report' });
  expect(link).toHaveAttribute('href', '/coordinator/reports?view=full&session=session-a');
  expect(
    screen.getByRole('button', { name: 'Download database evidence (JSON)' }),
  ).toBeInTheDocument();
});

it('the full view query selects the complete report instead of the paginated summary', async () => {
  view('/coordinator/reports?view=full&session=session-a');
  expect(
    screen.getByRole('heading', { name: 'Complete printable report fixture' }),
  ).toBeInTheDocument();
  expect(live.rpc).not.toHaveBeenCalled();
});

it('never downloads a private export that finishes after the report workspace unmounts', async () => {
  let finish!: (value: { data: unknown; error: null }) => void;
  const pending = new Promise<{ data: unknown; error: null }>((resolve) => {
    finish = resolve;
  });
  live.rpc.mockImplementation((name: string) =>
    name === 'fyp_reports_page' ? Promise.resolve({ data: page, error: null }) : pending,
  );
  const original = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const download = vi.fn(() => 'blob:private-report');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: download });
  try {
    const mounted = view();
    await screen.findByRole('link', { name: 'Open full printable report' });
    await userEvent.click(
      screen.getByRole('button', { name: 'Download database evidence (JSON)' }),
    );
    mounted.unmount();
    await act(async () => {
      finish({
        data: {
          actor_id: 'coordinator-a',
          sessions: [],
          groups: [],
          capacities: [],
          milestones: [],
          participants: [],
          people: [],
          topics: [],
          health: [],
          defenses: [],
          results: [],
          peer_reviews: [],
          audit: [],
          assessment_audit: [],
        },
        error: null,
      });
      await pending;
    });
    expect(download).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(URL, 'createObjectURL', original);
    else Reflect.deleteProperty(URL, 'createObjectURL');
  }
});
