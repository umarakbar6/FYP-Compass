import { assertPublicEnvironment } from './public-environment.mjs';
assertPublicEnvironment(process.env);
for (const name of [
  'VITE_LOCAL_BACKEND',
  'VITE_DEMO_MODE',
  'VITE_QA_REVIEW_ENABLED',
  'VITE_INVITES_ENABLED',
  'VITE_REMINDER_EMAIL_ENABLED',
])
  if (process.env[name] !== undefined && !['true', 'false'].includes(process.env[name]))
    throw Error('Use exact true/false for ' + name + '.');
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url))
  throw new Error('Set VITE_SUPABASE_URL to the owned cloud Supabase project.');
if (!key) throw new Error('Set the public VITE_SUPABASE_ANON_KEY in Vercel.');
if (key.startsWith('sb_secret_') || key.startsWith('sbp_'))
  throw new Error('Server credentials must never be used in browser configuration.');
if (!key.startsWith('sb_publishable_')) {
  let claims;
  try {
    claims = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString());
  } catch {
    throw new Error('Invalid public Supabase key.');
  }
  if (claims.role !== 'anon')
    throw new Error('Only the anon/public key may be included in the frontend.');
  if (claims.ref && new URL(url).hostname.split('.')[0] !== claims.ref)
    throw new Error('Public key and project URL do not match.');
}
if (process.env.VITE_LOCAL_BACKEND === 'true' || process.env.VITE_DEMO_MODE === 'true')
  throw new Error('Cloud deployment cannot use local demo authentication.');
console.log('Cloud browser configuration validated; no server secrets printed.');
if (process.env.VITE_BACKEND_API && process.env.VITE_BACKEND_API !== 'v2')
  throw new Error('Cloud deployment requires backend API v2.');
