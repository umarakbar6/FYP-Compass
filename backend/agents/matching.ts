export type Candidate = { id: string; proposal: { supervisor_ids: string[]; topic_ids: string[] } };
export type Capacity = {
  supervisor_id: string;
  max_groups: number;
  allocated?: number;
  topic_ids?: string[];
};
export function matchingPreview(
  groups: Candidate[],
  capacities: Capacity[],
  semantic: Record<string, number> = {},
) {
  if (
    groups.length > 200 ||
    capacities.length > 100 ||
    new Set(groups.map((g) => g.id)).size !== groups.length ||
    new Set(capacities.map((c) => c.supervisor_id)).size !== capacities.length ||
    capacities.some(
      (c) =>
        !Number.isInteger(c.max_groups) ||
        c.max_groups < 0 ||
        c.max_groups > 1000 ||
        !Number.isInteger(c.allocated || 0) ||
        (c.allocated || 0) < 0 ||
        (c.allocated || 0) > c.max_groups,
    ) ||
    groups.some(
      (g) =>
        g.proposal.supervisor_ids.length !== 3 ||
        new Set(g.proposal.supervisor_ids).size !== 3 ||
        g.proposal.topic_ids.length > 3,
    ) ||
    Object.values(semantic).some((x) => !Number.isFinite(x) || x < -1 || x > 1)
  )
    throw Error('Invalid or excessive matching evidence.');
  const remaining = new Map(
    capacities.map((c) => [c.supervisor_id, Math.max(0, c.max_groups - (c.allocated || 0))]),
  );
  const expertise = new Map(capacities.map((c) => [c.supervisor_id, new Set(c.topic_ids || [])]));
  const proposed: {
    group_id: string;
    supervisor_id: string;
    preference_rank: number;
    topic_matches: number;
    semantic_similarity: number | null;
  }[] = [];
  for (let rank = 0; rank < 3; rank++) {
    const pending = groups
      .filter((g) => !proposed.some((p) => p.group_id === g.id))
      .map((g) => {
        const target = g.proposal.supervisor_ids[rank];
        return {
          g,
          target,
          topic: g.proposal.topic_ids.filter((t) => expertise.get(target)?.has(t)).length,
          similarity: semantic[g.id + ':' + target] ?? -1,
        };
      })
      .sort(
        (a, b) => b.topic - a.topic || b.similarity - a.similarity || a.g.id.localeCompare(b.g.id),
      );
    for (const { g, target, topic, similarity } of pending) {
      if ((remaining.get(target) || 0) <= 0) continue;
      remaining.set(target, (remaining.get(target) || 0) - 1);
      proposed.push({
        group_id: g.id,
        supervisor_id: target,
        preference_rank: rank + 1,
        topic_matches: topic,
        semantic_similarity: similarity === -1 ? null : similarity,
      });
    }
  }
  return {
    proposed,
    unmatched: groups.filter((g) => !proposed.some((p) => p.group_id === g.id)).map((g) => g.id),
    method:
      'Preference rounds first, then topic overlap, semantic fit and stable ID; draft preview. Saved matching remains authoritative.',
  };
}
