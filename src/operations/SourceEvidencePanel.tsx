import { useState } from 'react';
import type { ExternalScreening } from '../../backend/agents/external-screening';
import { downloadScreeningReport, type ScreeningReportContext } from './screening-report';
export function SourceEvidencePanel({
  report,
  context,
}: {
  report: ExternalScreening;
  context?: ScreeningReportContext;
}) {
  const [downloadStatus, setDownloadStatus] = useState('');
  function download() {
    try {
      downloadScreeningReport(report, context);
      setDownloadStatus('Text report sent to your browser. Check your Downloads folder.');
    } catch {
      setDownloadStatus('The report could not be prepared. Please try downloading again.');
    }
  }
  return (
    <section aria-labelledby="source-screening-title">
      <h3 id="source-screening-title">External source screening evidence</h3>
      <p>{report.coverage}</p>
      <p>
        <strong>{report.conclusion}</strong>
      </p>
      <p>
        Search terms: {report.query} · Checked {new Date(report.checkedAt).toLocaleString()}
      </p>
      <ul>
        {report.providers.map((p) => (
          <li key={p.name}>
            {p.name}: {p.status} · {p.retrieved} sources with usable text
          </li>
        ))}
      </ul>
      {report.sources.map((s) => (
        <article key={s.id} className="engagement-card">
          <h4>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title || s.id}
            </a>
          </h4>
          <p>
            {s.provider} · {s.scope} · {s.checkedCharacters} source characters checked
          </p>
          <p>
            <strong>{s.status}</strong>
            {s.exactSharedWords > 0 && ` · ${s.exactSharedWords} consecutive shared words shown`}
          </p>
          <p>Retrieved source passage:</p>
          <blockquote>{s.sourcePassage}</blockquote>
          {s.proposalPassage && (
            <>
              <p>Matching proposal passage:</p>
              <blockquote>{s.proposalPassage}</blockquote>
            </>
          )}
          <p>
            This is text overlap evidence, not a misconduct decision. Review quotations, citations
            and context.
          </p>
        </article>
      ))}
      <button className="button" type="button" onClick={download}>
        Download formal report (.txt)
      </button>
      <p>A readable report with the AI review, source links, passages and coverage limits.</p>
      {downloadStatus && <p role="status">{downloadStatus}</p>}
    </section>
  );
}
