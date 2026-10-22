import type { HealthResult, HealthText } from './types';
export function fallbackHealthText(result: HealthResult): HealthText {
  const evidence = [...new Set(result.rules.map((rule) => rule.evidence))].join(' ');
  const suffix = '… Additional evidence is available in the triggered rules.';
  const reasons =
    evidence.length > 4000
      ? evidence.slice(0, 4000 - suffix.length) + suffix
      : evidence || 'Review the saved health rules with your supervisor.';
  const summaries: Record<string, string> = {
    DEADLINE_UPCOMING: 'A milestone deadline is approaching.',
    MILESTONE_OVERDUE: 'Milestone evidence is overdue.',
    MILESTONE_LATE: 'Milestone evidence was submitted late.',
    REPEATED_REWORK: 'Repeated rework needs attention.',
    CONTRIBUTIONS_MISSING: 'Contribution statements are outstanding.',
    PEER_RATINGS_MISSING: 'Submit any remaining peer ratings.',
    PEER_AVERAGE_LOW: 'Contribution evidence needs a supervisor review.',
    PEER_RATING_SPREAD: 'Peer feedback needs a supervisor review.',
    CONTRIBUTION_DIFFERENCE: 'Contribution assessments need a supervisor review.',
  };
  const studentReasons = [
    ...new Set(
      result.rules.map(
        (rule) => summaries[rule.code] || 'Project evidence needs a supervisor review.',
      ),
    ),
  ].join(' ');
  const action =
    result.level === 'red'
      ? 'Contact your supervisor and agree a recovery plan for the outstanding evidence.'
      : result.level === 'amber'
        ? 'Review upcoming deadlines and complete outstanding contributions or peer ratings.'
        : 'Continue the agreed project plan and keep evidence up to date.';
  return {
    explanation: result.level === 'green' ? 'No configured health rules were triggered.' : reasons,
    action,
    message:
      'Project health is ' +
      result.level.toUpperCase() +
      '. ' +
      (studentReasons ? studentReasons + ' ' : '') +
      action,
  };
}
export function validateHealthText(value: unknown): HealthText {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Health explanation is invalid.');
  const record = value as Record<string, unknown>;
  const keys = ['explanation', 'action', 'message'];
  if (
    Object.keys(record).some((key) => !keys.includes(key)) ||
    keys.some(
      (key) =>
        typeof record[key] !== 'string' ||
        !(record[key] as string).trim() ||
        (record[key] as string).length > 4000,
    )
  )
    throw new Error('Health explanation must contain only explanation, action and message.');
  if (
    /AIza[\w-]{30,}|sb_secret_[\w-]{10,}|-----BEGIN .*PRIVATE KEY|<script\b|javascript:/i.test(
      JSON.stringify(record),
    )
  )
    throw Error('Unsafe health explanation.');
  return {
    explanation: (record.explanation as string).trim(),
    action: (record.action as string).trim(),
    message: (record.message as string).trim(),
  };
}
export async function generateHealthText(
  result: HealthResult,
  generate?: (risk: HealthResult) => Promise<unknown>,
): Promise<HealthText & { source: 'gemini' | 'fallback' }> {
  if (generate) {
    try {
      return { ...validateHealthText(await generate(structuredClone(result))), source: 'gemini' };
    } catch {
      /* Provider unavailable, refused or returned malformed output: use the fixed-rule fallback. */
    }
  }
  return { ...fallbackHealthText(result), source: 'fallback' };
}
