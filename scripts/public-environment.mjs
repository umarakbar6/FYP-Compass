export const publicEnvironmentNames = Object.freeze([
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_BACKEND_API',
  'VITE_LOCAL_BACKEND',
  'VITE_DEMO_MODE',
  'VITE_QA_REVIEW_ENABLED',
  'VITE_INVITES_ENABLED',
  'VITE_REMINDER_EMAIL_ENABLED',
  'VITE_APP_ORIGIN',
  'VITE_SUPPORT_EMAIL',
  'VITE_TURNSTILE_SITE_KEY',
]);
export function assertPublicEnvironment(environment) {
  for (const [name, raw] of Object.entries(environment)) {
    if (!name.startsWith('VITE_')) continue;
    if (!publicEnvironmentNames.includes(name))
      throw Error(
        'Unapproved browser environment variable: ' + name + '. Keep server secrets unprefixed.',
      );
    const value = String(raw || '');
    if (
      /AIza[\w-]{30,}|sb_secret_|sbp_|-----BEGIN [\w ]*PRIVATE KEY|postgres(?:ql)?:\/\//i.test(
        value,
      )
    )
      throw Error('A server credential was placed in browser configuration: ' + name);
    for (const token of value.match(/(?:eyJ[\w-]+|e30)\.[\w-]+\.[\w-]+/g) || []) {
      let claims;
      try {
        claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      } catch {
        throw Error('Unexpected token in browser configuration: ' + name);
      }
      if (name !== 'VITE_SUPABASE_ANON_KEY' || claims.role !== 'anon')
        throw Error('An elevated or session token was placed in browser configuration: ' + name);
    }
  }
}

// Vercel automatically injects these documented framework variables. This app does
// not need them in the browser. Unknown names (including OIDC tokens) still fail.
export function stripAutomaticVercelMetadata(environment) {
  // This provider-only namespace is excluded from Vite's browser prefix list.
  // Discard all unused provider metadata, including newly introduced fields.
  for (const name of Object.keys(environment)) {
    if (name !== 'VITE_VERCEL' && !name.startsWith('VITE_VERCEL_')) continue;
    if (/SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|SERVICE_ROLE/.test(name))
      throw Error('Credential-looking provider variable must stay server-only: ' + name);
    delete environment[name];
  }
}
