import { agentKinds, type AgentKind } from './engine.ts';
export interface AgentRequest {
  kind: AgentKind;
  project_id: string | null;
  question: string;
  consent: true;
  search_terms?: string;
  external_sources?: true;
  source_consent?: true;
  schedule?: { start: string; rooms: string[]; slots: number; minutes: 60 };
}
export function validateAgentRequest(value: unknown, now = Date.now()): AgentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid request.');
  const b = value as Record<string, unknown>;
  const allowed = [
    'kind',
    'project_id',
    'question',
    'consent',
    'schedule',
    'external_sources',
    'source_consent',
    'search_terms',
  ];
  if (
    Object.keys(b).some((k) => !allowed.includes(k)) ||
    !agentKinds.includes(b.kind as AgentKind) ||
    b.consent !== true ||
    typeof b.question !== 'string' ||
    b.question.length > 1500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(b.question)
  )
    throw Error('Invalid request.');
  if (b.external_sources !== undefined || b.source_consent !== undefined) {
    if (b.kind !== 'proposal' || b.external_sources !== true || b.source_consent !== true)
      throw Error(
        'External source screening requires explicit search consent and proposal evidence.',
      );
  }
  if (
    b.search_terms !== undefined &&
    (b.external_sources !== true ||
      typeof b.search_terms !== 'string' ||
      !b.search_terms.trim() ||
      b.search_terms.length > 180 ||
      /[\u0000-\u001f]/.test(b.search_terms))
  )
    throw Error('Invalid public search terms.');
  const projectKind = ['proposal', 'document'].includes(b.kind as string);
  if (
    projectKind
      ? typeof b.project_id !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.project_id)
      : b.project_id !== null
  )
    throw Error('Invalid project.');
  if (b.kind === 'support' && !b.question.trim()) throw Error('Supply a support question.');
  if (b.kind !== 'scheduler' && b.schedule !== undefined) throw Error('Unexpected schedule.');
  if (b.kind === 'scheduler') {
    if (!b.schedule || typeof b.schedule !== 'object' || Array.isArray(b.schedule))
      throw Error('Supply schedule.');
    const s = b.schedule as Record<string, unknown>;
    if (
      Object.keys(s).sort().join(',') !== 'minutes,rooms,slots,start' ||
      typeof s.start !== 'string' ||
      !Number.isFinite(Date.parse(s.start)) ||
      Date.parse(s.start) <= now ||
      Date.parse(s.start) > now + 183 * 86400000 ||
      s.minutes !== 60 ||
      !Number.isInteger(s.slots) ||
      Number(s.slots) < 1 ||
      Number(s.slots) > 40 ||
      !Array.isArray(s.rooms) ||
      s.rooms.length < 1 ||
      s.rooms.length > 10 ||
      s.rooms.some(
        (x) => typeof x !== 'string' || !x.trim() || x.length > 120 || /[\u0000-\u001f]/.test(x),
      )
    )
      throw Error('Invalid schedule.');
    if (new Set(s.rooms.map((x) => (x as string).trim().toLowerCase())).size !== s.rooms.length)
      throw Error('Duplicate rooms.');
  }
  return b as unknown as AgentRequest;
}
