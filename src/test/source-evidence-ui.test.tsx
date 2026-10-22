import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SourceEvidencePanel } from '../operations/SourceEvidencePanel';
import type { ExternalScreening } from '../../backend/agents/external-screening';
afterEach(cleanup);
const report: ExternalScreening = {
  checkedAt: '2026-10-14T05:00:00Z',
  query: 'plant disease',
  sources: [
    {
      id: 'paper1',
      url: 'https://europepmc.org/article/MED/123',
      title: 'Retrieved paper',
      provider: 'Europe PMC',
      scope: 'Paper abstract only',
      checkedCharacters: 1000,
      sourcePassage: 'Actual retrieved passage with at least eight consecutive words',
      proposalPassage: 'Actual retrieved passage with at least eight consecutive words',
      exactSharedWords: 10,
      status: 'exact passage overlap',
    },
  ],
  providers: [
    { name: 'Europe PMC', status: 'checked', retrieved: 1 },
    { name: 'Wikipedia', status: 'unavailable', retrieved: 0 },
  ],
  coverage: 'Abstracts and selected extracts only.',
  conclusion: 'Requires human review.',
};
it('shows source links, matched passages, provider failure and human review without a verdict', () => {
  render(<SourceEvidencePanel report={report} />);
  expect(screen.getByRole('link', { name: 'Retrieved paper' })).toHaveAttribute(
    'href',
    report.sources[0].url,
  );
  expect(screen.getAllByText(report.sources[0].sourcePassage)).toHaveLength(2);
  expect(screen.getByText(/Wikipedia: unavailable/)).toBeVisible();
  expect(screen.getByText('Requires human review.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Download formal report (.txt)' })).toBeEnabled();
});
it('renders malicious source text as inert text, never executable HTML', () => {
  render(
    <SourceEvidencePanel
      report={{
        ...report,
        sources: [{ ...report.sources[0], sourcePassage: '<script>bad()</script>' }],
      }}
    />,
  );
  expect(screen.getByText('<script>bad()</script>')).toBeVisible();
  expect(document.querySelector('script')).toBeNull();
});
it('shows insufficient evidence when no sources are available', () => {
  render(
    <SourceEvidencePanel
      report={{ ...report, sources: [], conclusion: 'Insufficient retrieved evidence.' }}
    />,
  );
  expect(screen.getByText('Insufficient retrieved evidence.')).toBeVisible();
  expect(screen.queryByRole('link')).toBeNull();
});
