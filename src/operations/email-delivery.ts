import { supabase } from '../lib/supabase';
export async function deliverEmail(body: Record<string, unknown>, expectedActor: string) {
  if (!supabase) throw Error('Connected email delivery is unavailable.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== expectedActor)
    throw Error('Your session changed. Sign in and approve the message again.');
  const response = await fetch('/api/reminder-email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: 'Bearer ' + data.session.access_token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(50000),
  });
  if (response.status === 409)
    throw Error(
      'This delivery is already processing or needs coordinator reconciliation. It will not be sent twice automatically.',
    );
  if (response.status === 429) throw Error('The daily email limit has been reached.');
  const result = await response.json().catch(() => null);
  if (
    !response.ok ||
    result?.status !== 'sent' ||
    typeof result?.reference !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result.reference,
    )
  )
    throw Error(
      'Delivery could not be confirmed. Check the saved delivery status before retrying.',
    );
  return result.reference as string;
}
