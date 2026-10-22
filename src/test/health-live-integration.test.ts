import { loadHealthWorkspace } from '../health/api';
import type { PortalUser } from '../types/shared';
const live = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ demoEnabled: false, supabase: { rpc: live.rpc } }));
const user: PortalUser = {
  id: 'live-supervisor',
  role: 'supervisor',
  full_name: 'Supervisor',
  email: 'test@example.test',
};
beforeEach(() => vi.clearAllMocks());
it('reports a missing live health contract without silently switching to a local demo', async () => {
  live.rpc.mockResolvedValue({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function' },
  });
  await expect(loadHealthWorkspace(user)).rejects.toThrow(
    'Health notices are temporarily unavailable',
  );
  expect(live.rpc).toHaveBeenCalledOnce();
  expect(live.rpc).toHaveBeenCalledWith('get_health_workspace', undefined);
  expect(localStorage.length).toBe(0);
});
it('rejects a live health workspace belonging to a different signed-in actor', async () => {
  live.rpc.mockResolvedValue({
    data: { actor_id: 'another-supervisor', projects: [], reports: [], notices: [] },
    error: null,
  });
  await expect(loadHealthWorkspace(user)).rejects.toThrow('different account');
});
it('retains useful errors for an existing but unauthorized health contract', async () => {
  live.rpc.mockResolvedValue({
    data: null,
    error: { code: '42501', message: 'Assigned supervisor required' },
  });
  await expect(loadHealthWorkspace(user)).rejects.toThrow('Assigned supervisor required');
});
function supersededWorkspace() {
  const date = '2026-10-12T12:00:00Z';
  return {
    actor_id: user.id,
    projects: [
      {
        id: 'project',
        name: 'Team',
        title: 'Project',
        supervisor_id: user.id,
        member_ids: ['student'],
        prepared: false,
        health: { level: 'green', rules: [], fingerprint: 'new-evidence', calculated_at: date },
      },
    ],
    reports: [
      {
        id: 'report',
        project_id: 'project',
        risk_fingerprint: 'old-evidence',
        source: 'gemini',
        status: 'rejected',
        version: 2,
        created_at: date,
        reviewed_at: date,
        reviewer_id: null,
        explanation: 'Previous evidence.',
        action: 'Review current evidence.',
        message: 'Ask your supervisor.',
      },
    ],
    notices: [],
  };
}
it('accepts backend supersession of an old draft without a human reviewer', async () => {
  const data = supersededWorkspace();
  live.rpc.mockResolvedValue({ data, error: null });
  await expect(loadHealthWorkspace(user)).resolves.toEqual(data);
});
it('still rejects an approved message without a human reviewer', async () => {
  const data = supersededWorkspace();
  data.reports[0].status = 'approved';
  live.rpc.mockResolvedValue({ data, error: null });
  await expect(loadHealthWorkspace(user)).rejects.toThrow('invalid');
});
it('rejects automated rejection without the backend version transition', async () => {
  const data = supersededWorkspace();
  data.reports[0].version = 1;
  live.rpc.mockResolvedValue({ data, error: null });
  await expect(loadHealthWorkspace(user)).rejects.toThrow('invalid');
});
it('rejects a rejected draft attributed to an unrelated reviewer', async () => {
  const data = supersededWorkspace();
  Object.assign(data.reports[0], { reviewer_id: 'another-supervisor' });
  live.rpc.mockResolvedValue({ data, error: null });
  await expect(loadHealthWorkspace(user)).rejects.toThrow('invalid');
});
