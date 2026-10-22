import { readBoundedJson } from '../http/read-json.ts';
import { stripMarkup } from '../http/markup-text.ts';
export type Source = {
  id: string;
  title: string;
  url: string;
  provider: string;
  scope: string;
  text: string;
};
export type SourceEvidence = Omit<Source, 'text'> & {
  checkedCharacters: number;
  sourcePassage: string;
  proposalPassage: string | null;
  exactSharedWords: number;
  status: 'exact passage overlap' | 'retrieved, no exact passage overlap';
};
export type ExternalScreening = {
  checkedAt: string;
  query: string;
  sources: SourceEvidence[];
  providers: { name: string; status: 'checked' | 'unavailable'; retrieved: number }[];
  coverage: string;
  conclusion: string;
};
function plain(value: unknown): string {
  return typeof value === 'string'
    ? stripMarkup(value)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}
function words(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    value: m[0].toLocaleLowerCase('en-US'),
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}
export function passageEvidence(proposal: string, source: Source): SourceEvidence {
  const a = words(proposal.slice(0, 12000)),
    b = words(source.text.slice(0, 15000));
  const lookup = new Map<string, number[]>();
  for (let i = 0; i <= b.length - 8; i++) {
    const key = b
      .slice(i, i + 8)
      .map((w) => w.value)
      .join(' ');
    lookup.set(key, [...(lookup.get(key) || []), i]);
  }
  let best: { ai: number; bi: number; length: number } | undefined;
  for (let i = 0; i <= a.length - 8; i++) {
    const key = a
      .slice(i, i + 8)
      .map((w) => w.value)
      .join(' ');
    for (const j of (lookup.get(key) || []).slice(0, 20)) {
      let length = 8;
      while (
        length < 24 &&
        i + length < a.length &&
        j + length < b.length &&
        a[i + length].value === b[j + length].value
      )
        length++;
      if (!best || length > best.length) best = { ai: i, bi: j, length };
    }
  }
  const snippet = best
    ? source.text.slice(b[best.bi].start, b[best.bi + best.length - 1].end)
    : source.text.slice(b[0]?.start || 0, b[Math.min(23, b.length - 1)]?.end || 0);
  const { text: _, ...metadata } = source;
  return {
    ...metadata,
    checkedCharacters: source.text.slice(0, 15000).length,
    sourcePassage: snippet,
    proposalPassage: best
      ? proposal.slice(a[best.ai].start, a[best.ai + best.length - 1].end)
      : null,
    exactSharedWords: best?.length || 0,
    status: best ? 'exact passage overlap' : 'retrieved, no exact passage overlap',
  };
}
export function searchQuery(title: string): string {
  const terms = (title.match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2).slice(0, 12);
  const query = terms.join(' ').slice(0, 180);
  if (query.length < 4 || /@|https?:|AIza|sb_secret_/i.test(title))
    throw Error('A suitable public search title is required.');
  return query;
}
export async function externalScreening(
  title: string,
  abstract: string,
  requestFetch: typeof fetch = fetch,
): Promise<ExternalScreening> {
  const query = searchQuery(title),
    sources: Source[] = [],
    providers: ExternalScreening['providers'] = [];
  async function get(url: string) {
    const response = await requestFetch(url, {
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FYPCompassSourceScreening/1.0 (bounded academic comparison)',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error('Source provider unavailable');
    return readBoundedJson(response, 500000);
  }
  const tasks = [
    {
      name: 'Europe PMC',
      run: async () => {
        const u = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
        u.search = new URLSearchParams({
          query,
          resultType: 'core',
          format: 'json',
          pageSize: '4',
        }).toString();
        const data = await get(u.href);
        return (data.resultList?.result || [])
          .slice(0, 4)
          .flatMap((p: { id?: string; source?: string; title?: string; abstractText?: string }) => {
            if (
              !p.id ||
              p.id.length > 80 ||
              !p.source ||
              !/^[A-Z]+$/.test(p.source) ||
              !/^[\w.-]+$/.test(p.id)
            )
              return [];
            const text = plain(p.abstractText).slice(0, 15000);
            return text.length >= 80
              ? [
                  {
                    id: 'epmc-' + p.source + '-' + p.id,
                    title: plain(p.title).slice(0, 300),
                    url:
                      'https://europepmc.org/article/' + p.source + '/' + encodeURIComponent(p.id),
                    provider: 'Europe PMC',
                    scope: 'Paper abstract only',
                    text,
                  },
                ]
              : [];
          });
      },
    },
    {
      name: 'Crossref',
      run: async () => {
        const u = new URL('https://api.crossref.org/works');
        u.search = new URLSearchParams({ 'query.bibliographic': query, rows: '4' }).toString();
        const data = await get(u.href);
        return (data.message?.items || [])
          .slice(0, 4)
          .flatMap((p: { DOI?: string; title?: string[]; abstract?: string }) => {
            if (
              typeof p.DOI !== 'string' ||
              p.DOI.length > 200 ||
              !/^10\.\d{4,9}\/[^\s<>]+$/.test(p.DOI)
            )
              return [];
            const text = plain(p.abstract).slice(0, 15000);
            return text.length >= 80
              ? [
                  {
                    id: 'doi-' + p.DOI,
                    title: plain(p.title?.[0]).slice(0, 300),
                    url: 'https://doi.org/' + encodeURIComponent(p.DOI),
                    provider: 'Crossref',
                    scope: 'Publisher supplied abstract only',
                    text,
                  },
                ]
              : [];
          });
      },
    },
    {
      name: 'Wikipedia',
      run: async () => {
        const u = new URL('https://en.wikipedia.org/w/api.php');
        u.search = new URLSearchParams({
          action: 'query',
          generator: 'search',
          gsrsearch: query,
          gsrlimit: '3',
          prop: 'extracts|info',
          explaintext: '1',
          exchars: '10000',
          inprop: 'url',
          format: 'json',
          formatversion: '2',
        }).toString();
        const data = await get(u.href);
        return (data.query?.pages || [])
          .slice(0, 3)
          .flatMap((p: { pageid?: number; title?: string; extract?: string }) => {
            if (!Number.isSafeInteger(p.pageid) || Number(p.pageid) <= 0) return [];
            const text = plain(p.extract).slice(0, 15000);
            return text.length >= 80
              ? [
                  {
                    id: 'wiki-' + p.pageid,
                    title: plain(p.title).slice(0, 300),
                    url: 'https://en.wikipedia.org/?curid=' + p.pageid,
                    provider: 'Wikipedia',
                    scope: 'Retrieved article extract only',
                    text,
                  },
                ]
              : [];
          });
      },
    },
  ];
  const results = await Promise.allSettled(tasks.map((t) => t.run()));
  results.forEach((r, i) => {
    providers.push({
      name: tasks[i].name,
      status: r.status === 'fulfilled' ? 'checked' : 'unavailable',
      retrieved: r.status === 'fulfilled' ? r.value.length : 0,
    });
    if (r.status === 'fulfilled') sources.push(...r.value);
  });
  const unique = [...new Map(sources.map((s) => [s.url, s])).values()].slice(0, 11);
  const matches = unique.map((s) => passageEvidence(abstract, s));
  return {
    checkedAt: new Date().toISOString(),
    query,
    sources: matches,
    providers,
    coverage:
      'Title search across Europe PMC and Crossref paper abstracts and Wikipedia article extracts only. At most 11 retrieved sources; maximum 15000 characters per source and 12000 proposal characters. Paywalls, unreturned papers, full web and full uploaded documents are not covered.',
    conclusion: matches.length
      ? 'Retrieved evidence requires human review. Exact overlaps can be quotations or common wording; no match does not prove originality.'
      : 'Insufficient retrieved text evidence. Do not infer originality or a plagiarism verdict.',
  };
}
export function validateSourceReferences(references: string[], report: ExternalScreening) {
  const allowed = new Set(report.sources.map((s) => s.url));
  for (const reference of references)
    for (const url of reference.match(/https?:\/\/[^\s<>"']+/g) || [])
      if (!allowed.has(url.replace(/[),.;]+$/, '')))
        throw Error('Unverified external source reference.');
}
