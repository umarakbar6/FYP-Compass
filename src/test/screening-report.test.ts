import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ExternalScreening } from '../../backend/agents/external-screening';
import { downloadScreeningReport, screeningReportText } from '../operations/screening-report';
const report: ExternalScreening = {
  checkedAt: '2026-10-14T07:02:18.954Z',
  query: 'Research topic',
  providers: [
    { name: 'Europe PMC', status: 'checked', retrieved: 1 },
    { name: 'Crossref', status: 'unavailable', retrieved: 0 },
  ],
  sources: [
    {
      id: 'p1',
      title: 'Research paper',
      url: 'https://europepmc.org/article/MED/123',
      provider: 'Europe PMC',
      scope: 'Paper abstract only',
      checkedCharacters: 400,
      sourcePassage: 'An actual source passage for evidence review.',
      proposalPassage: 'An actual source passage for evidence review.',
      exactSharedWords: 8,
      status: 'exact passage overlap',
    },
  ],
  coverage: 'Only retrieved abstracts.',
  conclusion: 'Human review required.',
};
const context = {
  projectName: 'Synthetic project',
  reference: 'run-123',
  draft: {
    summary: 'Review summary.',
    findings: ['A finding.'],
    actions: ['Review the citation.'],
    references: [],
  },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Formal report export', () => {
  it('includes project identity, AI review and complete evidence in readable text', () => {
    const text = screeningReportText(report, context);
    for (const expected of [
      'PROPOSAL REVIEW AND SOURCE SCREENING REPORT',
      'Synthetic project',
      'run-123',
      '2026-10-14 07:02:18 UTC',
      'Review summary.',
      'A finding.',
      'Review the citation.',
      report.sources[0].url,
      report.sources[0].sourcePassage,
      'Matching proposal passage:',
      'Sources with exact passage overlap: 1',
      'Crossref: Unavailable; coverage is incomplete',
      '6. LIMITATIONS',
    ])
      expect(text).toContain(expected);
    expect(() => JSON.parse(text)).toThrow();
  });
  it('does not present unavailable or empty searches as proof of originality', () => {
    const text = screeningReportText({ ...report, sources: [] });
    expect(text).toContain('insufficient external evidence');
    expect(text).toContain('does not establish originality');
    expect(text).toContain('No source passages available');
  });
  it('preserves Unicode, encodes source content as plain text and handles missing metadata', () => {
    const text = screeningReportText({
      ...report,
      checkedAt: 'bad-date',
      query: 'تحقیق café <script>example</script>',
    });
    expect(text).toContain('تحقیق café <script>example</script>');
    expect(text).toContain('Screening date: Not recorded');
    expect(text).toContain('Report reference: Not recorded');
  });
  it('downloads a nonempty UTF8 text document and keeps its URL alive until the browser consumes it', async () => {
    vi.useFakeTimers();
    const create = vi.fn<(blob: Blob) => string>(() => 'blob:test-report');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    let attached = false;
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      attached = this.isConnected;
      name = this.download;
    });
    downloadScreeningReport(report, context);
    expect(attached).toBe(true);
    expect(name).toMatch(/Report-\d+\.txt$/);
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(blob.size).toBeGreaterThan(1000);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(revoke).toHaveBeenCalledWith('blob:test-report');
  });
});

