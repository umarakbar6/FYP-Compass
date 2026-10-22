import { AgentWorkspace } from '../operations/AgentWorkspace';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DecisionAssistant } from '../operations/DecisionAssistant';
import { PortalRoutes } from '../App';
const state = vi.hoisted(() => ({
  enabled: false,
  rpc: vi.fn(),
  invoke: vi.fn(),
  actor: 'demo-supervisor',
  user: {
    id: 'demo-supervisor',
    full_name: 'Demo Supervisor',
    email: 'supervisor@example.test',
    role: 'supervisor' as const,
  },
}));
vi.mock('../lib/supabase', () => ({
  get supabase() {
    return state.enabled ? { rpc: state.rpc, functions: { invoke: state.invoke } } : null;
  },
  demoEnabled: true,
  backendError: null,
}));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => {
    if (state.user.id !== state.actor) state.user = { ...state.user, id: state.actor };
    return { user: state.user, loading: false, error: null };
  },
}));
beforeEach(() => {
  state.enabled = false;
  state.actor = 'demo-supervisor';
  state.rpc.mockReset();
  state.invoke.mockReset();
});
const saved = (project = 'g1') => ({
  id: 'saved-draft',
  project_id: project,
  kind: 'proposal',
  status: 'draft',
  source: 'gemini',
  created_at: '2026-10-12T00:00:00Z',
  draft: {
    summary: 'Private prior draft',
    findings: ['Review scope'],
    actions: ['Read original'],
    references: [],
  },
});
function panel(project = 'g1') {
  return (
    <MemoryRouter>
      <DecisionAssistant projectId={project} kind="proposal" />
    </MemoryRouter>
  );
}
function RouteProbe() {
  const l = useLocation();
  return <output data-testid="route">{l.pathname + l.search}</output>;
}
it('proposal assistant link opens the actual authorized assistant route and selected kind', async () => {
  render(
    <MemoryRouter initialEntries={['/supervisor/proposals/proposal-nexus']}>
      <RouteProbe />
      <PortalRoutes />
    </MemoryRouter>,
  );
  const link = await screen.findByRole('link', { name: 'Open proposal review assistant' });
  expect(link.getAttribute('href')).toMatch(/^\/supervisor\/assistants\?kind=proposal&project=/);
  await userEvent.click(link);
  expect(
    await screen.findByRole('heading', { name: 'AI assistants' }, { timeout: 15000 }),
  ).toBeInTheDocument();
  expect(screen.getByTestId('route').textContent).toMatch(
    /^\/supervisor\/assistants\?kind=proposal&project=/,
  );
  expect(screen.getByLabelText('Assistant')).toHaveValue('proposal');
});
it('rejected history requests keep the evidence panel usable without exposing raw errors', async () => {
  state.enabled = true;
  state.rpc.mockRejectedValue(Error('private backend detail'));
  render(panel());
  expect(await screen.findByText(/Saved drafts are temporarily unavailable/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'AI proposal review' })).toBeInTheDocument();
  expect(screen.queryByText(/private backend detail/)).not.toBeInTheDocument();
});
it('a late history response cannot cross an account change', async () => {
  state.enabled = true;
  let resolve!: (value: { data: unknown[]; error: null }) => void;
  state.rpc
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ data: [], error: null });
  const view = render(panel());
  state.actor = 'other-supervisor';
  view.rerender(panel());
  await act(async () => {
    resolve({ data: [saved()], error: null });
  });
  expect(screen.queryByText('Private prior draft')).not.toBeInTheDocument();
});
it('a late history response cannot appear under another project', async () => {
  state.enabled = true;
  let resolve!: (value: { data: unknown[]; error: null }) => void;
  state.rpc
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ data: [], error: null });
  const view = render(panel());
  view.rerender(panel('g2'));
  await act(async () => {
    resolve({ data: [saved()], error: null });
  });
  expect(screen.queryByText('Private prior draft')).not.toBeInTheDocument();
});
it('malformed saved AI drafts are rejected without breaking the original review controls', async () => {
  state.enabled = true;
  const invalid = { ...saved(), draft: { summary: 'Unvalidated summary' } };
  state.rpc.mockResolvedValue({ data: [invalid], error: null });
  render(panel());
  expect(await screen.findByText(/Saved drafts are temporarily unavailable/)).toBeInTheDocument();
  expect(screen.queryByText('Unvalidated summary')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open proposal review assistant' })).toBeInTheDocument();
});

it('document selector includes authorized historical evidence projects', async () => {
  state.enabled = true;
  state.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === 'fyp_v2_core_get_supervisor_workspace'
        ? { proposals: [{ group_id: 'active', title: 'Active project' }] }
        : name === 'fyp_v2_core_get_milestone_workspace'
          ? { projects: [{ id: 'archived', title: 'Historical authorized evidence' }] }
          : [],
  }));
  render(
    <MemoryRouter initialEntries={['/?kind=document&project=archived']}>
      <AgentWorkspace />
    </MemoryRouter>,
  );
  expect(
    await screen.findByRole('option', { name: 'Historical authorized evidence' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Authorized project')).toHaveValue('archived');
});
it('optional historical read failure preserves the active project selector', async () => {
  state.enabled = true;
  state.rpc.mockImplementation(async (name: string) => {
    if (name === 'fyp_v2_core_get_milestone_workspace') throw Error('private failure');
    return {
      error: null,
      data:
        name === 'fyp_v2_core_get_supervisor_workspace'
          ? { proposals: [{ group_id: 'active', title: 'Active project' }] }
          : [],
    };
  });
  render(
    <MemoryRouter initialEntries={['/?kind=document']}>
      <AgentWorkspace />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('option', { name: 'Active project' })).toBeInTheDocument();
  expect(screen.queryByText('private failure')).not.toBeInTheDocument();
});
it('malformed optional project arrays do not break the active workspace', async () => {
  state.enabled = true;
  state.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === 'fyp_v2_core_get_supervisor_workspace'
        ? { proposals: [{ group_id: 'active', title: 'Active project' }] }
        : name === 'fyp_v2_core_get_milestone_workspace'
          ? { projects: { malformed: true } }
          : [],
  }));
  render(
    <MemoryRouter initialEntries={['/?kind=document']}>
      <AgentWorkspace />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('option', { name: 'Active project' })).toBeInTheDocument();
});

function mockTwoProjectHistory() {
  state.enabled = true;
  state.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === 'fyp_agents_history'
        ? [{ ...saved('g2'), report: null }]
        : name === 'fyp_v2_core_get_supervisor_workspace'
          ? {
              proposals: [
                { group_id: 'g1', title: 'Current project' },
                { group_id: 'g2', title: 'Saved project' },
              ],
            }
          : { projects: [] },
  }));
  return render(
    <MemoryRouter initialEntries={['/?kind=proposal&project=g1']}>
      <AgentWorkspace />
    </MemoryRouter>,
  );
}

it('opening saved evidence clears prior consent, instructions and external searches before any new export', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  try {
    mockTwoProjectHistory();
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Open saved draft' });
    await user.type(
      screen.getByLabelText('Optional focus or review instructions'),
      'Old project instructions',
    );
    await user.click(screen.getByRole('checkbox', { name: /Add external source screening/ }));
    await user.type(screen.getByLabelText(/Optional public search keywords/), 'old public search');
    await user.click(
      screen.getByRole('checkbox', { name: /I am authorized to send this project evidence/ }),
    );
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Open saved draft' }));
    expect(screen.getByLabelText('Authorized project')).toHaveValue('g2');
    expect(screen.getByLabelText('Optional focus or review instructions')).toHaveValue('');
    expect(
      screen.getByRole('checkbox', { name: /I am authorized to send this project evidence/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /Add external source screening/ }),
    ).not.toBeChecked();
    expect(screen.queryByLabelText(/Optional public search keywords/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(state.invoke).not.toHaveBeenCalled();
    state.invoke.mockResolvedValue({
      data: {
        id: 'new-draft',
        source: 'gemini',
        requires_human_approval: true,
        draft: saved().draft,
      },
      error: null,
    });
    await user.click(
      screen.getByRole('checkbox', { name: /I am authorized to send this project evidence/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(state.invoke).toHaveBeenCalledWith('fyp-assistants-v1', {
      body: { kind: 'proposal', project_id: 'g2', question: '', consent: true },
    });
    expect(screen.getByRole('note')).toHaveTextContent('not uploaded file contents');
  } finally {
    scroll.mockRestore();
  }
});

it('saved-history controls cannot switch project context during an in-flight generation', async () => {
  mockTwoProjectHistory();
  let finish!: (value: unknown) => void;
  state.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Open saved draft' });
  await user.click(
    screen.getByRole('checkbox', { name: /I am authorized to send this project evidence/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Generate draft' }));
  expect(screen.getByRole('button', { name: 'Open saved draft' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Open saved draft' }));
  expect(screen.getByLabelText('Authorized project')).toHaveValue('g1');
  await act(async () => {
    finish({
      data: {
        id: 'current-draft',
        source: 'gemini',
        requires_human_approval: true,
        draft: saved().draft,
      },
      error: null,
    });
  });
  expect(screen.getByRole('button', { name: 'Open saved draft' })).toBeEnabled();
  expect(screen.getByLabelText('Authorized project')).toHaveValue('g1');
});
