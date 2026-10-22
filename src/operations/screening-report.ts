import type { ExternalScreening } from '../../backend/agents/external-screening';
import type { Draft } from '../../backend/agents/engine';

export type ScreeningReportContext = { projectName?: string; reference?: string; draft?: Draft };

export function screeningReportText(
  report: ExternalScreening,
  context: ScreeningReportContext = {},
) {
  const clean = (value: string) =>
    value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  const date = new Date(report.checkedAt);
  const checked = Number.isNaN(date.getTime())
    ? 'Not recorded'
    : date
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, ' UTC');
  const overlaps = report.sources.filter((s) => s.exactSharedWords > 0).length;
  const lines = [
    'FYP COMPASS',
    'PROPOSAL REVIEW AND SOURCE SCREENING REPORT',
    '',
    `Project: ${clean(context.projectName || 'Authorized project')}`,
    `Report reference: ${clean(context.reference || 'Not recorded')}`,
    `Screening date: ${checked}`,
    'Status: Draft for human review',
    `Search keywords: ${clean(report.query)}`,
    '',
    '1. EXECUTIVE SUMMARY',
    '',
    context.draft
      ? clean(context.draft.summary)
      : 'This report records the available external source screening evidence.',
    '',
    `Sources with usable text: ${report.sources.length}`,
    `Sources with exact passage overlap: ${overlaps}`,
    overlaps
      ? 'Review the matching passages alongside their citations and surrounding context.'
      : 'No exact passage overlap was found in the retrieved text. This does not establish originality.',
    ...(report.sources.length
      ? []
      : [
          'No usable source text was retrieved. There is insufficient external evidence to assess overlap.',
        ]),
    '',
    '2. AI REVIEW FINDINGS',
    '',
    ...(context.draft?.findings.length
      ? context.draft.findings.map((x, i) => `${i + 1}. ${clean(x)}`)
      : ['No AI findings were included in this report.']),
    '',
    '3. SEARCH COVERAGE AND PROVIDER RESULTS',
    '',
    clean(report.coverage),
    '',
    ...report.providers.map(
      (p) =>
        `${clean(p.name)}: ${p.status === 'unavailable' ? 'Unavailable; coverage is incomplete' : 'Search completed'}; ${p.retrieved} sources with usable text.`,
    ),
    '',
    '4. SOURCE EVIDENCE AND PASSAGE COMPARISON',
    '',
  ];
  for (const [i, source] of report.sources.entries()) {
    lines.push(
      `Source ${i + 1}: ${clean(source.title || source.id)}`,
      `Provider: ${clean(source.provider)}`,
      `Source link: ${clean(source.url)}`,
      `Coverage: ${clean(source.scope)}`,
      `Source characters checked: ${source.checkedCharacters}`,
      `Result: ${source.exactSharedWords > 0 ? 'Exact passage overlap found' : 'No exact passage overlap found'}`,
      `Consecutive shared words shown: ${source.exactSharedWords}`,
      '',
      'Retrieved source passage:',
      clean(source.sourcePassage) || 'No passage available.',
      '',
      'Matching proposal passage:',
      source.proposalPassage
        ? clean(source.proposalPassage)
        : 'No matching passage was identified.',
      '',
    );
  }
  if (!report.sources.length) lines.push('No source passages available for comparison.', '');
  lines.push(
    '5. RECOMMENDED NEXT ACTIONS',
    '',
    ...(context.draft?.actions.length
      ? context.draft.actions.map((x, i) => `${i + 1}. ${clean(x)}`)
      : ['Review the available evidence with the project supervisor.']),
    '',
    '6. LIMITATIONS AND REVIEW REQUIREMENTS',
    '',
    clean(report.conclusion),
    'This screening covers only the retrieved text described above. It does not search every paper, website, paywalled publication or uploaded document.',
    'Exact overlap may reflect quotations or common wording. Missing overlap is not proof of originality. No plagiarism percentage or misconduct decision is assigned.',
    'Gemini review findings are advisory. A supervisor must check the original sources, citations and context before making any academic decision.',
    '',
    'Prepared by FYP Compass',
    'End of report',
    '',
  );
  return lines.join('\r\n');
}

export function downloadScreeningReport(
  report: ExternalScreening,
  context: ScreeningReportContext = {},
) {
  const blob = new Blob(['\ufeff', screeningReportText(report, context)], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = report.checkedAt.replace(/[^0-9]/g, '').slice(0, 14) || 'report';
  link.href = url;
  link.download = `FYP-Compass-Source-Screening-Report-${stamp}.txt`;
  link.hidden = true;
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Allow the browser to consume the download before releasing the object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
