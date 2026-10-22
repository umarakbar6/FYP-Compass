import { expect, it, vi } from 'vitest';
import { stripMarkup } from '../../backend/http/markup-text';
import { externalScreening } from '../../backend/agents/external-screening';

it('extracts ordinary tagged text without changing entity decoding or executable-looking plain text', () => {
  expect(stripMarkup('<p>Research &amp; development</p><br/>Next')).toBe(
    ' Research &amp; development  Next',
  );
  expect(stripMarkup('text <unterminated')).toBe('text <unterminated');
  expect(stripMarkup('')).toBe('');
});

it('handles large unterminated and nested-angle input without repeated suffix searches', () => {
  const hostile = '<'.repeat(150000);
  expect(stripMarkup(hostile)).toBe(hostile);
  expect(stripMarkup(hostile + '>safe')).toBe(' safe');
  expect(stripMarkup('safe' + hostile)).toBe('safe' + hostile);
});

it('preserves following text across many complete tags', () => {
  const source = '<w:p>visible</w:p>'.repeat(20000) + '<unfinished';
  expect(stripMarkup(source)).toBe(' visible '.repeat(20000) + '<unfinished');
});

it('bounds adversarial provider text and keeps source requests on the fixed API hosts', async () => {
  const hostile = '<'.repeat(150000);
  const requests: { url: URL; redirect: RequestRedirect | undefined }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, redirect: init?.redirect });
    return Response.json(
      url.hostname === 'www.ebi.ac.uk'
        ? {
            resultList: {
              result: [
                { id: '123', source: 'MED', title: 'Synthetic paper', abstractText: hostile },
              ],
            },
          }
        : {},
    );
  });
  const result = await externalScreening(
    'Adversarial synthetic research',
    'An original proposal.',
    fetcher as typeof fetch,
  );
  expect(requests).toHaveLength(3);
  for (const { url, redirect } of requests) {
    expect(['www.ebi.ac.uk', 'api.crossref.org', 'en.wikipedia.org']).toContain(url.hostname);
    expect(url.protocol).toBe('https:');
    expect(redirect).toBe('error');
  }
  expect(result.sources).toHaveLength(1);
  expect(result.sources[0].checkedCharacters).toBe(15000);
  expect(result.sources[0].exactSharedWords).toBe(0);
});
