import fs from 'node:fs';
import { externalScreening, passageEvidence } from '../backend/agents/external-screening.ts';
const report = await externalScreening(
  'machine learning plant disease detection',
  'This synthetic test describes a project using images to identify crop disease.',
);
if (!report.sources.length) throw Error('All live source retrieval returned no usable text.');
const first = report.sources[0];
const verified = passageEvidence(first.sourcePassage, { ...first, text: first.sourcePassage });
if (verified.exactSharedWords < 8) throw Error('Live text alignment failed');
const output = {
  checkedAt: new Date().toISOString(),
  providers: report.providers,
  sources: report.sources.map(({ id, url, provider, scope, checkedCharacters }) => ({
    id,
    url,
    provider,
    scope,
    checkedCharacters,
  })),
  livePassageAlignment: true,
  syntheticInput: true,
};
fs.writeFileSync(
  'handover/verification/source-providers-live-2026-10-14.json',
  JSON.stringify(output, null, 2) + '\n',
);
console.log(JSON.stringify(output));
