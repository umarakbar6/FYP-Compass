import type { MilestoneProject } from '../types/milestone';
import type { HealthInput, HealthResult, HealthRule } from './types';
export const HEALTH_RULE_VERSION = '2';
export function calculateHealth(
  project: MilestoneProject,
  input: HealthInput,
  now = Date.now(),
): HealthResult {
  if (
    !Number.isFinite(now) ||
    input.project_id !== project.id ||
    !Array.isArray(input.peers) ||
    typeof input.peers_required !== 'boolean'
  )
    throw new Error('Health input is invalid.');
  const memberIds = project.members.map((member) => member.id);
  if (
    !memberIds.length ||
    new Set(memberIds).size !== memberIds.length ||
    new Set(input.peers.map((p) => p.member_id)).size !== input.peers.length
  )
    throw new Error('Health members must be unique.');
  const rules: HealthRule[] = [];
  const add = (code: string, level: 'amber' | 'red', evidence: string) =>
    rules.push({ code, level, evidence });
  for (const item of project.milestones) {
    const deadline = Date.parse(item.deadline);
    if (!Number.isFinite(deadline)) throw new Error('Milestone deadline is invalid.');
    const latest = item.submissions.at(-1);
    if (latest && !Number.isFinite(Date.parse(latest.submitted_at)))
      throw new Error('Submission date is invalid.');
    if (item.status !== 'accepted' && deadline >= now && deadline - now <= 3 * 86400000)
      add(
        'DEADLINE_UPCOMING',
        'amber',
        item.name + ': deadline ' + item.deadline + ' is within three days.',
      );
    if (item.status !== 'accepted' && deadline < now && (!latest || item.status === 'needs_rework'))
      add(
        'MILESTONE_OVERDUE',
        'red',
        item.name +
          ': deadline ' +
          item.deadline +
          ' passed; acceptable evidence is still outstanding.',
      );
    if (latest && Date.parse(latest.submitted_at) > deadline)
      add(
        'MILESTONE_LATE',
        'amber',
        item.name +
          ': submitted ' +
          latest.submitted_at +
          ', after deadline ' +
          item.deadline +
          '.',
      );
    const reworks = item.submissions.filter((s) => s.review?.action === 'needs_rework').length;
    if (reworks >= 2)
      add('REPEATED_REWORK', 'red', item.name + ': ' + reworks + ' rework decisions.');
    if (latest) {
      const count = project.members.filter(
        (member) =>
          !latest.contributions.some((c) => c.student_id === member.id && c.statement.trim()),
      ).length;
      if (count)
        add(
          'CONTRIBUTIONS_MISSING',
          'amber',
          item.name + ': ' + count + ' contribution statements missing.',
        );
    }
  }
  for (const signal of input.peers) {
    if (
      !memberIds.includes(signal.member_id) ||
      !Array.isArray(signal.ratings) ||
      signal.ratings.length > memberIds.length - 1 ||
      signal.ratings.some((r) => !Number.isFinite(r) || r < 1 || r > 5) ||
      (signal.supervisor_percent !== null &&
        (!Number.isFinite(signal.supervisor_percent) ||
          signal.supervisor_percent < 0 ||
          signal.supervisor_percent > 100))
    )
      throw new Error('Peer health evidence is invalid.');
  }
  if (input.peers_required && memberIds.length > 1) {
    for (const id of memberIds) {
      const signal = input.peers.find((peer) => peer.member_id === id);
      if (!signal || signal.ratings.length < memberIds.length - 1)
        add(
          'PEER_RATINGS_MISSING',
          'amber',
          'Member ' +
            (memberIds.indexOf(id) + 1) +
            ': ' +
            (signal?.ratings.length || 0) +
            '/' +
            (memberIds.length - 1) +
            ' required peer ratings received.',
        );
      if (!signal?.ratings.length) continue;
      const average = signal.ratings.reduce((a, b) => a + b, 0) / signal.ratings.length;
      if (average < 2.5)
        add(
          'PEER_AVERAGE_LOW',
          'red',
          'Member ' +
            (memberIds.indexOf(id) + 1) +
            ': peer average ' +
            average.toFixed(2) +
            '/5 is below 2.5.',
        );
      if (Math.max(...signal.ratings) - Math.min(...signal.ratings) >= 2)
        add(
          'PEER_RATING_SPREAD',
          'amber',
          'Member ' +
            (memberIds.indexOf(id) + 1) +
            ': rating spread ' +
            (Math.max(...signal.ratings) - Math.min(...signal.ratings)).toFixed(2) +
            ' is at least two points.',
        );
      if (
        signal.supervisor_percent !== null &&
        Math.abs(((average - 1) / 4) * 100 - signal.supervisor_percent) > 30
      )
        add(
          'CONTRIBUTION_DIFFERENCE',
          'red',
          'Member ' +
            (memberIds.indexOf(id) + 1) +
            ': peer contribution ' +
            (((average - 1) / 4) * 100).toFixed(2) +
            '%, supervisor contribution ' +
            signal.supervisor_percent.toFixed(2) +
            '%; difference exceeds 30 percentage points.',
        );
    }
  }
  rules.sort((a, b) => (a.code + a.evidence).localeCompare(b.code + b.evidence));
  // The exact serialized evidence identifies the snapshot; it is not a security hash.
  const fingerprint = JSON.stringify({
    version: HEALTH_RULE_VERSION,
    project_id: project.id,
    rules,
  });
  return {
    level: rules.some((rule) => rule.level === 'red') ? 'red' : rules.length ? 'amber' : 'green',
    rules,
    calculated_at: new Date(now).toISOString(),
    fingerprint,
  };
}
