import {
  createHealthAgentHandler,
  geminiGenerator,
  type HealthAgentDependencies,
} from '../../backend/health-agent/handler';
import { initialMilestoneProjects } from '../lib/milestone-api';
import { calculateHealth } from '../health/rules';
vi.mock('../lib/supabase', () => ({ supabase: null, demoEnabled: true }));
function setup() {
  const project = initialMilestoneProjects()[0];
  const snapshot = {
    project,
    input: { project_id: project.id, peers_required: true, peers: [] },
    version: 1,
  };
  const deps: HealthAgentDependencies = {
    origin: 'http://127.0.0.1:5180',
    authenticate: vi.fn(async () => ({ id: 'demo-supervisor', role: 'supervisor' })),
    prepare: vi.fn(async () => snapshot),
    save: vi.fn(async () => {}),
    generate: vi.fn(async () => ({
      explanation: 'Evidence requires review.',
      action: 'Contact your supervisor.',
      message: 'Prepare your recovery plan.',
    })),
  };
  return { deps, snapshot, handler: createHealthAgentHandler(deps) };
}
const request = (
  body: object,
  headers: Record<string, string> = { authorization: 'Bearer test' },
) =>
  new Request('http://localhost/health', { method: 'POST', headers, body: JSON.stringify(body) });
it('saves authorized Gemini text against server-calculated risk without publishing', async () => {
  const { deps, snapshot, handler } = setup();
  const result = await handler(request({ project_id: snapshot.project.id }));
  expect(result.status).toBe(200);
  expect(deps.save).toHaveBeenCalledOnce();
  const args = vi.mocked(deps.save).mock.calls[0];
  expect(args[2].level).toBe('red');
  expect(args[4]).toBe('gemini');
  expect(args[5]).toBe(1);
});
it('rejects unauthenticated, non-supervisor and unassigned requests before generating', async () => {
  const { deps, snapshot, handler } = setup();
  expect((await handler(request({ project_id: snapshot.project.id }, {}))).status).toBe(401);
  vi.mocked(deps.authenticate).mockResolvedValue({ id: 'student', role: 'student' });
  expect((await handler(request({ project_id: snapshot.project.id }))).status).toBe(403);
  vi.mocked(deps.authenticate).mockResolvedValue({ id: 'other', role: 'supervisor' });
  expect((await handler(request({ project_id: snapshot.project.id }))).status).toBe(403);
  expect(deps.generate).not.toHaveBeenCalled();
});
it('rejects injected client health evidence and disallowed origins', async () => {
  const { deps, snapshot, handler } = setup();
  expect((await handler(request({ project_id: snapshot.project.id, level: 'green' }))).status).toBe(
    400,
  );
  expect(
    (
      await handler(
        request(
          { project_id: snapshot.project.id },
          { authorization: 'Bearer test', origin: 'https://evil.example' },
        ),
      )
    ).status,
  ).toBe(403);
  expect(deps.save).not.toHaveBeenCalled();
});
it('persists the fallback when Gemini fails or returns a risk override', async () => {
  const { deps, snapshot, handler } = setup();
  vi.mocked(deps.generate!).mockRejectedValue(new Error('offline'));
  expect((await handler(request({ project_id: snapshot.project.id }))).status).toBe(200);
  expect(vi.mocked(deps.save).mock.calls[0][4]).toBe('fallback');
});
it('returns a controlled failure if a concurrent database save is rejected', async () => {
  const { deps, snapshot, handler } = setup();
  vi.mocked(deps.save).mockRejectedValue(new Error('stale version'));
  expect((await handler(request({ project_id: snapshot.project.id }))).status).toBe(503);
});
it('constructs a structured Gemini REST request and parses the response', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      explanation: 'Explanation',
                      action: 'Action',
                      message: 'Message',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const generator = geminiGenerator('test-only-key', 'configured-model', fetcher as typeof fetch);
  const p = initialMilestoneProjects()[0];
  const result = await generator(
    calculateHealth(p, { project_id: p.id, peers_required: false, peers: [] }),
  );
  expect(result).toEqual({ explanation: 'Explanation', action: 'Action', message: 'Message' });
  const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(options[1].body as string);
  expect(body.generationConfig.responseFormat.text.mimeType).toBe('application/json');
  expect(body.contents[0].parts[0].text).not.toContain('Ayesha');
});
