export interface SimilarityProposal {
  id: string;
  title: string;
  abstract: string;
}
export interface ScreeningResult {
  percentage: number;
  closest_title: string | null;
  closest_proposal_id: string | null;
  status: 'clear' | 'flagged';
  threshold: number;
  screened_at: string;
  method: string;
  disclaimer: string;
}
export const SIMILARITY_THRESHOLD = 60;
export const SIMILARITY_DISCLAIMER =
  'Internal screening compares proposals stored in this portal. It is not a plagiarism verdict and does not automatically reject a proposal.';
export const DEMO_SIMILARITY_PROPOSALS: SimilarityProposal[] = [
  {
    id: 'archive-campus',
    title: 'Campus Project Tracking System',
    abstract:
      'The Campus Project Tracking Platform project addresses a practical problem through a focused software solution. The team will investigate user needs, design a working prototype, and evaluate the result against clear project objectives.',
  },
  {
    id: 'archive-rain',
    title: 'Rainfall Forecasting Sensor Network',
    abstract:
      'Weather stations collect rainfall, humidity and atmospheric pressure. Time series forecasts estimate storm intensity and irrigation requirements for agricultural fields.',
  },
  {
    id: 'archive-library',
    title: 'Library Book Recommendation Engine',
    abstract:
      'Readers receive book suggestions using catalogue metadata, borrowing history and literary preferences. Evaluation measures recommendation accuracy and catalogue diversity.',
  },
];
function validateProposal(value: SimilarityProposal) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.title !== 'string' ||
    typeof value.abstract !== 'string'
  )
    throw new Error('Similarity proposal records are invalid.');
  if (value.title.length + value.abstract.length > 50000)
    throw new Error('Prepare proposal text within 50,000 characters for demo screening.');
}
function trigrams(text: string) {
  const result = new Set<string>();
  const words =
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  for (const word of words) {
    const chars = Array.from('  ' + word + ' ');
    for (let index = 0; index + 2 < chars.length; index++)
      result.add(chars.slice(index, index + 3).join(''));
  }
  return result;
}
export function screenProposal(
  target: SimilarityProposal,
  corpus: SimilarityProposal[],
  threshold = SIMILARITY_THRESHOLD,
  screenedAt = new Date().toISOString(),
): ScreeningResult {
  validateProposal(target);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100)
    throw new Error('Similarity threshold must be above zero and at most 100.');
  if (!Number.isFinite(Date.parse(screenedAt))) throw new Error('Screening date is invalid.');
  if (!Array.isArray(corpus)) throw new Error('Stored similarity proposals are invalid.');
  const input = trigrams(target.title + ' ' + target.abstract);
  if (!input.size)
    throw new Error('Prepare a proposal title or abstract containing searchable words.');
  const ids = new Set<string>();
  let closest: SimilarityProposal | null = null;
  let best = 0;
  for (const candidate of corpus) {
    validateProposal(candidate);
    if (ids.has(candidate.id)) throw new Error('Stored similarity proposal IDs must be unique.');
    ids.add(candidate.id);
    if (candidate.id === target.id) continue;
    const other = trigrams(candidate.title + ' ' + candidate.abstract);
    if (!other.size) continue;
    let common = 0;
    for (const token of input) if (other.has(token)) common++;
    const score = common / (input.size + other.size - common);
    if (score > best || (score === best && score > 0 && closest && candidate.id < closest.id)) {
      best = score;
      closest = candidate;
    }
  }
  const percentage = Math.round(best * 10000) / 100;
  return {
    percentage,
    closest_title: closest?.title || null,
    closest_proposal_id: closest?.id || null,
    status: percentage >= threshold ? 'flagged' : 'clear',
    threshold,
    screened_at: screenedAt,
    method: 'demo-trigram-jaccard',
    disclaimer: SIMILARITY_DISCLAIMER,
  };
}
export function loadDemoSimilarityCorpus(): SimilarityProposal[] {
  const key = 'fyp-compass.similarity.corpus.v1';
  try {
    const stored = localStorage.getItem(key);
    const records: SimilarityProposal[] = stored ? JSON.parse(stored) : DEMO_SIMILARITY_PROPOSALS;
    if (!Array.isArray(records)) throw new Error('Invalid corpus.');
    const ids = new Set<string>();
    for (const record of records) {
      validateProposal(record);
      if (ids.has(record.id)) throw new Error('Duplicate proposal.');
      ids.add(record.id);
    }
    if (!stored) localStorage.setItem(key, JSON.stringify(records));
    return records;
  } catch {
    throw new Error(
      'Stored demo screening proposals could not be read or saved. Enable storage or reset the demo corpus.',
    );
  }
}
