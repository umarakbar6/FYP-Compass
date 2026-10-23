import { createLocalServer } from '../backend/local-tests/local-server.mjs';
import { createServer } from 'vite';

// One isolated local stack. Account pickers are loopback fixtures, never cloud credentials.
const port = Number(process.env.FYP_LOCAL_WEB_PORT || 5182);
const apiPort = Number(process.env.FYP_LOCAL_API_PORT || 54329);
for (const value of [port, apiPort])
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw Error('Choose local ports between 1024 and 65535.');
if (port === apiPort) throw Error('Website and API ports must differ.');
const origin = 'http://127.0.0.1:' + port;
const backend = await createLocalServer({ port: apiPort, origin });
let website;
try {
  Object.assign(process.env, {
    VITE_BACKEND_API: 'v2',
    VITE_LOCAL_BACKEND: 'true',
    VITE_DEMO_MODE: 'false',
    VITE_SUPABASE_URL: backend.url,
    VITE_SUPABASE_ANON_KEY: 'local-demo-public-client',
    VITE_TURNSTILE_SITE_KEY: '',
  });
  website = await createServer({
    mode: 'localbackend',
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await website.listen();
  console.log('FYP Compass local portal: ' + origin);
  console.log('Full production schema; nine local role accounts; persistent private local data.');
  console.log(
    'Choose an account on the login page. Health uses the required labeled fallback when Gemini is not configured.',
  );
} catch (error) {
  await backend.close();
  throw error;
}
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await website?.close();
    await backend.close();
    process.exit(0);
  });
