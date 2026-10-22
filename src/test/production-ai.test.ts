import {
  createHealthAgentHandler,
  type HealthAgentDependencies,
} from '../../backend/health-agent/handler';
import { initialMilestoneProjects } from '../lib/milestone-api';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true }));
function setup() {
  const project = initialMilestoneProjects()[0];
  const deps: HealthAgentDependencies = {
    origin: 'https://fyp-compass-ten.vercel.app',
    authenticate: vi.fn(async () => ({ id: 'demo-supervisor', role: 'supervisor' })),
    prepare: vi.fn(async () => ({
      project,
      input: { project_id: project.id, peers_required: true, peers: [] },
      version: 1,
    })),
    save: vi.fn(async () => {}),
    generate: vi.fn(async () => ({
      explanation: 'Review evidence',
      action: 'Arrange support',
      message: 'Prepare recovery',
    })),
    reserve: vi.fn(async () => ({ allowed: true, id: '00000000-0000-4000-8000-000000000001' })),
    record: vi.fn(async () => {}),
  };
  return {
    deps,
    run: () =>
      createHealthAgentHandler(deps)(
        new Request('https://local/health', {
          method: 'POST',
          headers: { authorization: 'Bearer test' },
          body: JSON.stringify({ project_id: project.id }),
        }),
      ),
  };
}
it('quota denial returns bounded Retry-After without invoking Google or save', async () => {
  const { deps, run } = setup();
  vi.mocked(deps.reserve!).mockResolvedValue({
    allowed: false,
    reason: 'daily_budget',
    retry_after: 90000,
  });
  const res = await run();
  expect(res.status).toBe(429);
  expect(res.headers.get('retry-after')).toBe('86400');
  expect(deps.generate).not.toHaveBeenCalled();
  expect(deps.save).not.toHaveBeenCalled();
});
it('existing or concurrent draft denial costs no generation request', async () => {
  for (const reason of ['active_draft', 'in_progress']) {
    const { deps, run } = setup();
    vi.mocked(deps.reserve!).mockResolvedValue({ allowed: false, reason });
    expect((await run()).status).toBe(409);
    expect(deps.generate).not.toHaveBeenCalled();
  }
});
it('reservation outages fail closed before provider invocation', async () => {
  const { deps, run } = setup();
  vi.mocked(deps.reserve!).mockRejectedValue(new Error('database unavailable'));
  expect((await run()).status).toBe(503);
  expect(deps.generate).not.toHaveBeenCalled();
});
it('successful generation records source and duration without academic decisions', async () => {
  const { deps, run } = setup();
  expect((await run()).status).toBe(200);
  expect(deps.record).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(String),
    'gemini',
    expect.any(Number),
    'ok',
  );
});
it('failed saves are counted and do not expose database messages', async () => {
  const { deps, run } = setup();
  vi.mocked(deps.save).mockRejectedValue(new Error('private database detail'));
  const res = await run();
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain('private database');
  expect(deps.record).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(String),
    'failed',
    expect.any(Number),
    'save_failed',
  );
});
it('telemetry outage preserves an already saved successful draft', async () => {
  const { deps, run } = setup();
  vi.mocked(deps.record!).mockRejectedValue(new Error('telemetry offline'));
  expect((await run()).status).toBe(200);
  expect(deps.save).toHaveBeenCalledOnce();
});

it('bounds streaming request bytes before JSON parsing and generation', async () => {
  const { deps } = setup();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2500));
      controller.close();
    },
  });
  const request = new Request('https://local/health', {
    method: 'POST',
    headers: { authorization: 'Bearer test' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  expect((await createHealthAgentHandler(deps)(request)).status).toBe(413);
  expect(deps.generate).not.toHaveBeenCalled();
});
