import { supabase } from '../lib/supabase';
export interface CaseStudy {
  id: string;
  title: string;
  challenge: string;
  solution: string;
  outcome: string;
  evidence: string;
  image: string;
  quote: string;
  attribution: string;
  consent?: boolean;
  verified?: boolean;
  published?: boolean;
  version?: number;
}
export interface Enquiry {
  id: string;
  full_name: string;
  email: string;
  plan: string;
  brief: string;
  status: string;
  version: number;
  created_at: string;
}
export interface Reminder {
  id: string;
  stage: string;
  deadline: string;
  name: string;
  group_name: string;
  status: string;
  read_at: string | null;
}
export interface EngagementWorkspace {
  role: string;
  onboarding: { task: string; completed: boolean }[];
  reminders_enabled: boolean;
  reminders: Reminder[];
  enquiries?: Enquiry[];
  cases?: CaseStudy[];
  reminder_run?: { ran_at: string; inserted: number };
}
async function rpc<T>(name: string, args = {}): Promise<T> {
  if (!supabase) throw new Error('Connect your assigned account to save changes.');
  const { data, error } = await supabase.rpc(name, args);
  if (error)
    throw new Error(
      error.code === '23514'
        ? 'Check field lengths, verify published claims, and provide permission and attribution for a client quote.'
        : error.code === '23502'
          ? 'Complete the required fields.'
          : error.message,
    );
  return data as T;
}
export function validateEngagementWorkspace(value: unknown): EngagementWorkspace {
  if (!value || typeof value !== 'object')
    throw new Error('Help and reminder records could not be read. Refresh to retry.');
  const v = value as EngagementWorkspace;
  if (
    !['student', 'supervisor', 'examiner', 'coordinator'].includes(v.role) ||
    typeof v.reminders_enabled !== 'boolean' ||
    !Array.isArray(v.onboarding) ||
    !Array.isArray(v.reminders) ||
    v.onboarding.some(
      (x) => !x || typeof x.task !== 'string' || typeof x.completed !== 'boolean',
    ) ||
    v.reminders.some(
      (x) =>
        !x ||
        typeof x.id !== 'string' ||
        typeof x.name !== 'string' ||
        !['72h', '24h', 'overdue'].includes(x.stage) ||
        !Number.isFinite(Date.parse(x.deadline)),
    )
  )
    throw new Error('Help and reminder records are invalid. Refresh to retry.');
  if (v.role === 'coordinator' && (!Array.isArray(v.enquiries) || !Array.isArray(v.cases)))
    throw new Error('Coordinator engagement records are invalid. Refresh to retry.');
  return v;
}
export const getEngagementWorkspace = async () =>
  validateEngagementWorkspace(await rpc<unknown>('fyp_engagement_workspace'));
export const engagementAction = (action: string, data: object) =>
  rpc<unknown>('fyp_engagement_action', { p_action: action, p_data: data }).then(
    validateEngagementWorkspace,
  );
export const getPublicCases = () => rpc<CaseStudy[]>('fyp_engagement_public_cases');
export const saveCase = (item: CaseStudy) =>
  rpc<unknown>('fyp_engagement_save_case', {
    p_id: item.id || null,
    p_content: item,
    p_expected_version: item.version || null,
  }).then(validateEngagementWorkspace);
export async function sendEnquiry(input: {
  request_id: string;
  name: string;
  email: string;
  plan: string;
  brief: string;
  consent: boolean;
  website: string;
  captcha_token?: string;
}): Promise<{ reference: string; status: string }> {
  if (!supabase)
    throw new Error('The enquiry service is unavailable. You can download your request instead.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    supabase.functions.invoke('fyp-enquiries-v1', { body: input }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'The request timed out. Retry with the same details; duplicate submissions are prevented.',
            ),
          ),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const { data, error } = result;
  if (error) {
    let message = 'Your request could not be confirmed. Please retry with the same details.';
    if ('context' in error && error.context instanceof Response) {
      const body = await error.context.json().catch(() => null);
      if (body?.error) message = String(body.error);
    }
    throw new Error(message);
  }
  if (!data?.reference || data.status !== 'received')
    throw new Error('The server did not confirm receipt. Please retry.');
  return data;
}
