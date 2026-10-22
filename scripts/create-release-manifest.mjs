import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalPublicRouting } from './portable-routing.mjs';
import { publicEnvironmentNames } from './public-environment.mjs';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function files(root, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      [
        'node_modules',
        '.private',
        '.git',
        '.vercel',
        '.temp',
        '.branches',
        'test',
        '__tests__',
      ].includes(entry.name)
    )
      continue;
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...files(root, name));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort();
}
export function createReleaseManifest(root = process.cwd(), environment = process.env) {
  const roots = [
    'src',
    'api',
    'backend/email',
    'backend/agents',
    'backend/http',
    'backend/health-agent',
    'supabase',
    'scripts',
  ];
  const source = roots
    .filter((name) => fs.existsSync(path.join(root, name)))
    .flatMap((name) => files(path.join(root, name)).map((file) => name + '/' + file));
  for (const name of [
    'package.json',
    'package-lock.json',
    'index.html',
    'vite.config.ts',
    'vercel.json',
    'deployment.public.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
  ])
    if (fs.existsSync(path.join(root, name))) source.push(name);
  const sources = source.sort().map((name) => ({
    file: name,
    sha256: hash(
      name === 'vercel.json'
        ? canonicalPublicRouting(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')))
        : fs.readFileSync(path.join(root, name)),
    ),
  }));
  const sourceFingerprint = hash(sources.map((item) => item.file + ':' + item.sha256).join('\n'));
  const publicConfigurationHash = hash(
    JSON.stringify(
      Object.fromEntries(
        publicEnvironmentNames.map((name) => [name, String(environment[name] || '')]),
      ),
    ),
  );
  const assets = files(path.join(root, 'dist'))
    .filter((name) => name !== 'release.json')
    .map((name) => {
      const bytes = fs.readFileSync(path.join(root, 'dist', name));
      return { file: name, bytes: bytes.length, sha256: hash(bytes) };
    });
  const manifest = {
    sourceHashMethod:
      'Raw source bytes; vercel.json uses canonical public routing controls and excludes provider-injected metadata.',
    version: 1,
    sourceFingerprint,
    publicConfigurationHash,
    sources,
    assets,
  };
  fs.writeFileSync(path.join(root, 'dist/release.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { sourceFingerprint, assets: assets.length };
}
