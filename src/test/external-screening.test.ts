import { describe, it, expect, vi } from 'vitest';
import {
  externalScreening,
  passageEvidence,
  searchQuery,
  validateSourceReferences,
  type Source,
} from '../../backend/agents/external-screening';
import { validateAgentRequest } from '../../backend/agents/request';
const text =
  'Our system uses convolutional neural networks to identify plant diseases from leaf images collected under varied lighting conditions and supports agricultural field monitoring.';
const source: Source = {
  id: 'paper-1',
  title: 'Plant disease detection',
  provider: 'Europe PMC',
  scope: 'Abstract only',
  url: 'https://europepmc.org/article/MED/123',
  text,
};
const request = {
  kind: 'proposal',
  project_id: '12345678-1234-1234-1234-123456789012',
  question: '',
  consent: true,
};
describe('External evidence screening', () => {
  it('aligns actual consecutive words in original source and proposal', () => {
    const result = passageEvidence('Introduction. ' + text, source);
    expect(result.exactSharedWords).toBe(23);
    expect(result.sourcePassage).toBe(result.proposalPassage);
    expect(source.text).toContain(result.sourcePassage);
    expect(result).not.toHaveProperty('text');
  });
  it('does not call a related topic an exact passage match', () => {
    expect(
      passageEvidence('A camera diagnoses unhealthy crops using a computer vision model.', source)
        .proposalPassage,
    ).toBeNull();
  });
  it('normalizes case and punctuation but retains original quotations', () => {
    const proposal = text.toUpperCase().replace('system uses', 'system, uses');
    const result = passageEvidence(proposal, source);
    expect(result.exactSharedWords).toBeGreaterThanOrEqual(8);
    expect(proposal).toContain(result.proposalPassage!);
  });
  it('rejects accidental short phrase overlap', () =>
    expect(
      passageEvidence('Our system uses convolutional neural networks.', source).exactSharedWords,
    ).toBe(0));
  it('does not export full documents or invent a percentage', () => {
    const result = passageEvidence(text, source);
    expect(result.sourcePassage.split(/\s+/).length).toBeLessThanOrEqual(24);
    expect(result).not.toHaveProperty('plagiarismPercentage');
  });
  it('sanitizes and bounds public search terms', () => {
    expect(searchQuery('Plant disease: "detection" (vision)')).toBe(
      'Plant disease detection vision',
    );
    expect(searchQuery('word '.repeat(100)).length).toBeLessThanOrEqual(180);
  });
  it('rejects email, URL and secret shaped titles', () => {
    for (const title of [
      'person@example.com',
      'https://private.example/path',
      'AIzaSecretValue',
      'a',
    ])
      expect(() => searchQuery(title)).toThrow();
  });
  it('requires separate source search consent and correct agent kind', () => {
    expect(
      validateAgentRequest({ ...request, external_sources: true, source_consent: true }),
    ).toHaveProperty('external_sources', true);
    for (const extra of [
      { external_sources: true },
      { source_consent: true },
      { external_sources: false, source_consent: true },
    ])
      expect(() => validateAgentRequest({ ...request, ...extra })).toThrow();
    expect(() =>
      validateAgentRequest({
        ...request,
        kind: 'document',
        external_sources: true,
        source_consent: true,
      }),
    ).toThrow();
  });
  it('retrieves genuine response text and builds only provider-owned source URLs', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === 'www.ebi.ac.uk')
        return Response.json({
          resultList: {
            result: [
              { id: '123', source: 'MED', title: 'A real returned paper', abstractText: text },
            ],
          },
        });
      if (url.hostname === 'api.crossref.org')
        return Response.json({
          message: {
            items: [
              {
                DOI: '10.1234/paper',
                title: ['Publisher paper'],
                abstract: '<jats:p>' + text + '</jats:p>',
              },
              { DOI: 'javascript:bad', title: ['bad'], abstract: text },
            ],
          },
        });
      return Response.json({
        query: {
          pages: [
            {
              pageid: 123,
              title: 'Web source',
              extract: text,
              fullurl: 'http://127.0.0.1/private',
            },
          ],
        },
      });
    });
    const result = await externalScreening('Plant disease detection', text, mock as typeof fetch);
    expect(result.sources).toHaveLength(3);
    expect(result.providers.every((p) => p.status === 'checked')).toBe(true);
    expect(result.sources[2].url).toBe('https://en.wikipedia.org/?curid=123');
    for (const [input] of mock.mock.calls)
      expect(['www.ebi.ac.uk', 'api.crossref.org', 'en.wikipedia.org']).toContain(
        new URL(String(input)).hostname,
      );
  });
  it.each([
    [
      'Research &amp; safety &lt;methods&gt; &quot;review&quot;',
      'Research & safety <methods> "review"',
    ],
    [
      'Literal &amp;lt;tag&amp;gt; and &amp;quot;quote&amp;quot;',
      'Literal &lt;tag&gt; and &quot;quote&quot;',
    ],
    ['Nested &amp;amp;lt; stays encoded', 'Nested &amp;lt; stays encoded'],
  ])('decodes provider entities once: %s', async (encoded, decoded) => {
    const mock = vi.fn(async (input: RequestInfo | URL) =>
      new URL(String(input)).hostname === 'www.ebi.ac.uk'
        ? Response.json({
            resultList: {
              result: [{ id: '123', source: 'MED', title: encoded, abstractText: text }],
            },
          })
        : Response.json({}),
    );
    const result = await externalScreening('Plant disease detection', text, mock as typeof fetch);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].title).toBe(decoded);
  });
  it('reports unavailable providers without certifying originality', async () => {
    const result = await externalScreening(
      'Plant disease detection',
      text,
      vi.fn().mockRejectedValue(Error('timeout')),
    );
    expect(result.sources).toHaveLength(0);
    expect(result.providers.every((p) => p.status === 'unavailable')).toBe(true);
    expect(result.conclusion).toContain('Insufficient');
  });
  it('handles absent abstracts as no usable evidence', async () => {
    const result = await externalScreening(
      'Plant disease detection',
      text,
      vi.fn().mockResolvedValue(Response.json({})),
    );
    expect(result.sources).toHaveLength(0);
    expect(result.conclusion).toContain('Insufficient');
  });
  it('rejects invented source links in AI references', () => {
    const report = { sources: [{ url: source.url }] } as Awaited<
      ReturnType<typeof externalScreening>
    >;
    expect(() => validateSourceReferences([source.url], report)).not.toThrow();
    expect(() => validateSourceReferences(['https://invented.example/paper'], report)).toThrow();
  });
  it('treats redirects and oversized provider responses as unavailable', async () => {
    const huge = JSON.stringify({ message: { items: [{ abstract: 'x'.repeat(500001) }] } });
    const result = await externalScreening(
      'Plant disease detection',
      text,
      vi.fn().mockImplementation(async () => new Response(huge)),
    );
    expect(result.providers.every((p) => p.status === 'unavailable')).toBe(true);
  });
});
