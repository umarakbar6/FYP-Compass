import fs from 'node:fs';
const vars = {};
for (const name of ['.env', '.env.local'])
  if (fs.existsSync(name))
    for (const line of fs.readFileSync(name, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) vars[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
const url = vars.VITE_SUPABASE_URL;
const key = vars.VITE_SUPABASE_ANON_KEY;
if (!url || !key || !/^https:\/\/[^/]+\.supabase\.co$/.test(url))
  throw new Error('A valid Supabase public URL and key are required.');
if (!key.startsWith('sb_publishable_')) {
  let claims;
  try {
    claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid public key format.');
  }
  if (claims.role !== 'anon')
    throw new Error('Elevated keys must never be used by this browser app.');
}
const headers = {
  apikey: key,
  'Content-Type': 'application/json',
  ...(key.startsWith('sb_publishable_') ? {} : { Authorization: 'Bearer ' + key }),
};
const targets = [
  ['auth_settings', '/auth/v1/settings'],
  ['anonymous_profiles', '/rest/v1/fyp_profiles?select=id&limit=0'],
  ['student_workspace', '/rest/v1/rpc/get_student_workspace', {}],
  ['supervisor_workspace', '/rest/v1/rpc/get_supervisor_workspace', {}],
  ['milestone_workspace', '/rest/v1/rpc/get_milestone_workspace', {}],
  ['partner_reports', '/rest/v1/rpc/fyp_role_module_data', { p_module: 'reports' }],
  ['health_workspace', '/rest/v1/rpc/get_health_workspace', {}],
];
const checks = [];
for (const [name, endpoint, body] of targets) {
  try {
    const response = await fetch(url + endpoint, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    let value;
    try {
      value = await response.json();
    } catch {}
    checks.push({
      name,
      http_status: response.status,
      code: typeof value?.code === 'string' ? value.code : null,
      classification: response.ok
        ? 'reachable'
        : value?.code === 'PGRST202'
          ? 'contract_missing_or_not_exposed'
          : [401, 403].includes(response.status)
            ? 'anonymous_access_denied'
            : 'request_failed',
    });
  } catch {
    checks.push({ name, http_status: 0, classification: 'network_or_timeout_failure' });
  }
}
const report = {
  checked_at: new Date().toISOString(),
  scope:
    'Connection and anonymous read-only checks. No account login, database mutation, user data collection or RLS certification.',
  checks,
};
fs.mkdirSync('handover', { recursive: true });
fs.writeFileSync('handover/connection-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
