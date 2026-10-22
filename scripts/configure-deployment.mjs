import fs from 'node:fs';
const args = process.argv.slice(2),
  get = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
const origin = get('--origin'),
  backend = get('--supabase-url'),
  support = get('--support-email') || '';
if (!origin || !backend)
  throw Error(
    'Supply --origin https://your-domain and --supabase-url https://your-project.supabase.co.',
  );
const app = new URL(origin),
  database = new URL(backend);
if (
  app.protocol !== 'https:' ||
  app.origin !== origin ||
  database.protocol !== 'https:' ||
  database.origin !== backend ||
  !/^[a-z0-9]+\.supabase\.co$/.test(database.hostname)
)
  throw Error('Use exact HTTPS origins.');
if (support && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(support))
  throw Error('Use a valid optional support email.');
const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const csp = config.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy');
csp.value = csp.value.replace(
  /connect-src [^;]+/,
  "connect-src 'self' " +
    backend +
    ' wss://' +
    database.hostname +
    ' https://challenges.cloudflare.com',
);
fs.writeFileSync('vercel.json', JSON.stringify(config, null, 2) + '\n');
fs.writeFileSync(
  'deployment.public.json',
  JSON.stringify(
    {
      appOrigin: origin,
      supabaseURL: backend,
      projectRef: database.hostname.split('.')[0],
      supportEmail: support,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Public deployment configuration generated. Set VITE_APP_ORIGIN, VITE_SUPPORT_EMAIL and HEALTH_APP_ORIGIN to the same verified configuration. No server credentials were read.',
);
