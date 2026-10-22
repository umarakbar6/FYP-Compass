import { loadEnv } from 'vite';
import { spawnSync } from 'node:child_process';
import { assertPublicEnvironment, stripAutomaticVercelMetadata } from './public-environment.mjs';
import { createReleaseManifest } from './create-release-manifest.mjs';
import { checkBrowserOutput } from './check-browser-output.mjs';
const localConfig = loadEnv('production', process.cwd(), 'VITE_');
stripAutomaticVercelMetadata(localConfig);
stripAutomaticVercelMetadata(process.env);
assertPublicEnvironment({ ...localConfig, ...process.env });
for (const name of Object.keys(localConfig))
  if (process.env[name] === undefined && localConfig[name] !== undefined)
    process.env[name] = localConfig[name];
await import('./check-cloud-env.mjs');
const env = {
  ...process.env,
  VITE_BACKEND_API: 'v2',
  VITE_LOCAL_BACKEND: 'false',
  VITE_DEMO_MODE: 'false',
};
for (const args of [
  ['node_modules/typescript/bin/tsc', '-b'],
  ['node_modules/vite/bin/vite.js', 'build'],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Release manifest: ' + JSON.stringify(createReleaseManifest(process.cwd(), env)));
console.log('Browser secret-exposure check: ' + JSON.stringify(checkBrowserOutput()));
