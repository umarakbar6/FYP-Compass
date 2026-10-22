import { geminiGenerator } from '../../backend/health-agent/handler';
import { generateHealthText } from '../health/agent';
import type { HealthResult } from '../health/types';
const risk = {
  level: 'amber',
  rules: [
    { code: 'PEER_RATINGS_MISSING', level: 'amber', evidence: 'Peer ratings are outstanding.' },
  ],
  calculated_at: '2026-10-10T00:00:00Z',
  fingerprint: 'test',
} as HealthResult;
const text = {
  explanation: 'Outstanding evidence needs review.',
  action: 'Complete the outstanding peer ratings.',
  message: 'Please review your project evidence with your supervisor.',
};
const wrap = (parts: unknown[], finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts } }],
});
const generator = (payload: unknown, status = 200) =>
  geminiGenerator(
    'test-only-key',
    'configured-model',
    vi.fn(
      async () =>
        new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status }),
    ) as typeof fetch,
  );
it('accepts complete structured text and excludes private thought content', async () => {
  expect(
    await generator(wrap([{ thought: true, text: 'internal' }, { text: JSON.stringify(text) }]))(
      risk,
    ),
  ).toEqual(text);
});
it.each([401, 403, 429, 500, 503])(
  'uses a visibly labelled fallback after provider HTTP %s',
  async (status) => {
    expect((await generateHealthText(risk, generator({}, status))).source).toBe('fallback');
  },
);
it('rejects truncated model output even when the partial JSON happens to parse', async () => {
  expect(
    (
      await generateHealthText(
        risk,
        generator(wrap([{ text: JSON.stringify(text) }], 'MAX_TOKENS')),
      )
    ).source,
  ).toBe('fallback');
});
it('handles safety refusals without persisting Gemini source', async () => {
  expect(
    (await generateHealthText(risk, generator({ promptFeedback: { blockReason: 'SAFETY' } })))
      .source,
  ).toBe('fallback');
});
it('rejects invalid JSON and missing candidates', async () => {
  for (const payload of ['invalid', {}])
    expect((await generateHealthText(risk, generator(payload))).source).toBe('fallback');
});
it('rejects extra fields and blank model output', async () => {
  for (const output of [
    { ...text, level: 'green' },
    { ...text, message: ' ' },
  ]) {
    const result = await generateHealthText(
      risk,
      generator(wrap([{ text: JSON.stringify(output) }])),
    );
    expect(result.source).toBe('fallback');
  }
});
it('bounds provider response bytes', async () => {
  expect((await generateHealthText(risk, generator('x'.repeat(64001)))).source).toBe('fallback');
});
it('does not leak provider errors or credentials through fallback text', async () => {
  const failed = geminiGenerator(
    'test-only-key',
    'configured-model',
    vi.fn(async () => {
      throw new Error('secret-provider-detail');
    }) as typeof fetch,
  );
  const out = await generateHealthText(risk, failed);
  expect(out.source).toBe('fallback');
  expect(JSON.stringify(out)).not.toContain('secret-provider-detail');
  expect(JSON.stringify(out)).not.toContain('test-only-key');
});
it('rejects unsafe model identifiers before any outbound request', () => {
  expect(() => geminiGenerator('test-only-key', '../other')).toThrow();
});

it('retries a rejected responseFormat field using the compatible JSON schema format', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Unknown name responseFormat' } }), {
        status: 400,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(wrap([{ text: JSON.stringify(text) }])), { status: 200 }),
    );
  expect(
    await geminiGenerator('test-only-key', 'configured-model', fetcher as typeof fetch)(risk),
  ).toEqual(text);
  const body = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseJsonSchema.required).toEqual([
    'explanation',
    'action',
    'message',
  ]);
  expect(body.generationConfig.responseFormat).toBeUndefined();
});

it('uses supported low thinking for a short Gemini 3.8 explanation within the existing output bound', async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _options?: RequestInit) =>
      new Response(JSON.stringify(wrap([{ text: JSON.stringify(text) }]))),
  );
  await geminiGenerator('test-only-key', 'gemini-3.8-flash', fetcher as typeof fetch)(risk);
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  expect(body.generationConfig.maxOutputTokens).toBe(2048);
});
