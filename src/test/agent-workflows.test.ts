import { agentKinds, generateAgentDraft, scheduleDraft } from '../../backend/agents/engine';
import { matchingPreview } from '../../backend/agents/matching';
import { createEnquiryHandler } from '../../backend/engagement/enquiry-handler';
for (const kind of agentKinds)
  it(kind + ' returns only a validated advisory draft from the provider', async () => {
    const fake = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.systemInstruction.parts[0].text).toContain('Never grade');
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: 'Evidence grounded draft',
                      findings: [],
                      actions: ['Human review'],
                      references: ['fixture'],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    const draft = await generateAgentDraft(
      'test-only-not-secret',
      'gemini-test',
      kind,
      { fixture: true },
      [],
      fake as typeof fetch,
    );
    expect(draft.actions).toEqual(['Human review']);
    expect(fake).toHaveBeenCalledOnce();
  });
it('provider outages and invalid outputs never become fabricated successful drafts', async () => {
  await expect(
    generateAgentDraft(
      'fixture',
      'gemini-test',
      'support',
      {},
      [],
      (async () => new Response('Unavailable', { status: 429 })) as typeof fetch,
    ),
  ).rejects.toThrow();
  await expect(
    generateAgentDraft(
      'fixture',
      'gemini-test',
      'support',
      {},
      [],
      (async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"summary":"Incomplete"}' }] } }],
          }),
        )) as typeof fetch,
    ),
  ).rejects.toThrow();
});
it('matching respects preference rounds, topic evidence and already occupied capacity', () => {
  const groups = [
    { id: 'a', proposal: { supervisor_ids: ['s1', 's2', 's3'], topic_ids: ['web'] } },
    { id: 'b', proposal: { supervisor_ids: ['s1', 's2', 's3'], topic_ids: ['web', 'ai'] } },
  ];
  const capacities = [
    { supervisor_id: 's1', max_groups: 2, allocated: 1, topic_ids: ['web', 'ai'] },
    { supervisor_id: 's2', max_groups: 1, allocated: 0, topic_ids: ['web'] },
  ];
  const draft = matchingPreview(groups, capacities, { 'a:s1': 1, 'b:s1': 0 });
  expect(draft.proposed[0].group_id).toBe('b');
  expect(draft.proposed[1].preference_rank).toBe(2);
  expect(draft.unmatched).toEqual([]);
});
it('scheduling never invents participant availability', () => {
  const base = {
    projects: [{ id: 'g', supervisor_id: 's', ready: true }],
    examiners: ['e1', 'e2'],
    rooms: ['A'],
    start: '2030-01-01T10:00:00Z',
    slots: 1,
    minutes: 60,
    existing: [],
  };
  expect(scheduleDraft({ ...base, availability: [] }).proposed).toHaveLength(0);
  expect(
    scheduleDraft({
      ...base,
      availability: ['s', 'e1', 'e2'].map((profile_id) => ({
        profile_id,
        starts_at: '2030-01-01T09:00:00Z',
        ends_at: '2030-01-01T12:00:00Z',
      })),
    }).proposed,
  ).toHaveLength(1);
});
it('enquiry CAPTCHA failures block storage even when all enquiry fields are valid', async () => {
  const receive = vi.fn(),
    handler = createEnquiryHandler({
      origin: 'https://example.test',
      verifyCaptcha: async () => false,
      fingerprint: async () => 'fixture',
      receive,
    });
  const result = await handler(
    new Request('https://example.test', {
      method: 'POST',
      headers: { origin: 'https://example.test', 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: '00000000-0000-4000-8000-000000000001',
        name: 'Test Person',
        email: 'person@example.test',
        plan: 'Basic',
        brief: 'A sufficiently detailed project brief.',
        consent: true,
        captcha_token: 'expired',
      }),
    }),
  );
  expect(result.status).toBe(403);
  expect(receive).not.toHaveBeenCalled();
});
