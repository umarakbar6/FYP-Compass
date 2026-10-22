export function parseEmailRequest(value) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.confirm !== true)
    throw Error('Approve the selected message first.');
  const test = value.type === 'delivery_test';
  if (!test && value.type !== 'reminder') throw Error('Invalid delivery type.');
  const fields = test
    ? ['type', 'confirm', 'request_id']
    : ['type', 'confirm', 'run_id', 'reminder_id'];
  if (
    Object.keys(value).some((k) => !fields.includes(k)) ||
    fields
      .filter((k) => k.endsWith('_id'))
      .some((k) => typeof value[k] !== 'string' || !uuid.test(value[k]))
  )
    throw Error('Invalid delivery request.');
  return value;
}

export async function emailSessionAllowed(client, actor) {
  try {
    const { data, error } = await client.rpc('fyp_security_context');
    return !error && data?.actor_id === actor && data?.mfa_required === false;
  } catch {
    return false;
  }
}
