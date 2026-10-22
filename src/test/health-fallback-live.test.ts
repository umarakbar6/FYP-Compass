import { createHealthDraft } from '../health/api';
import type { PortalUser } from '../types/shared';
const live = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../lib/supabase', () => ({
  demoEnabled: false,
  supabase: { rpc: live.rpc, functions: { invoke: live.invoke } },
}));
const user: PortalUser = {
  id: 'supervisor',
  full_name: 'Supervisor',
  email: 's@example.test',
  role: 'supervisor',
};
const workspace = () => ({
  actor_id: user.id,
  projects: [
    {
      id: 'p',
      name: 'Group',
      title: 'Project',
      supervisor_id: user.id,
      member_ids: ['student'],
      prepared: false,
      health: {
        level: 'red',
        rules: [
          { code: 'MILESTONE_OVERDUE', level: 'red', evidence: 'Report evidence is overdue.' },
        ],
        fingerprint: 'risk',
        calculated_at: '2026-10-08T12:00:00Z',
      },
    },
  ],
  reports: [],
  notices: [],
});
it('uses the authenticated database fallback when Edge generation is unavailable', async () => {
  live.rpc.mockResolvedValue({ data: workspace(), error: null });
  live.invoke.mockResolvedValue({ error: { message: 'Edge unavailable' } });
  await createHealthDraft(user, 'p');
  expect(live.rpc).toHaveBeenLastCalledWith('create_group_health_fallback', { p_project_id: 'p' });
});
it('does not hide a forbidden or failed database fallback behind simulated success', async () => {
  live.rpc.mockResolvedValueOnce({ data: workspace(), error: null }).mockResolvedValueOnce({
    data: null,
    error: { message: 'Assigned supervisor required', code: '42501' },
  });
  live.invoke.mockResolvedValue({ error: { message: 'Edge unavailable' } });
  await expect(createHealthDraft(user, 'p')).rejects.toThrow('Assigned supervisor required');
});
