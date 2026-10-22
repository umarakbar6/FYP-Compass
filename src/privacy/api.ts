import { supabase } from '../lib/supabase';
export async function privacyRequest(
  name: string,
  args: Record<string, unknown>,
  actor: string,
  isCurrent = () => true,
) {
  if (
    !supabase ||
    !['fyp_privacy_requests', 'fyp_privacy_submit', 'fyp_privacy_respond'].includes(name)
  )
    throw Error('Data requests are unavailable.');
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session || session.user.id !== actor || !isCurrent())
    throw Error('Your session changed. Sign in again.');
  // Bind the request to the approving account rather than a future SDK session.
  const result = await fetch(new URL('/rest/v1/rpc/' + name, import.meta.env.VITE_SUPABASE_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + session.access_token,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20000),
  });
  if (!result.ok)
    throw Error(
      result.status === 429
        ? 'The daily request limit has been reached.'
        : result.status === 409
          ? 'This request changed. Reload before responding.'
          : 'The request could not be confirmed. Reload before retrying; duplicate open requests are blocked.',
    );
  return result.json();
}
