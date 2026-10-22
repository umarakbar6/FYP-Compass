import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { parseEnv } from 'node:util';
import { publicEnvironmentNames, assertPublicEnvironment } from './public-environment.mjs';
const root = process.cwd();
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const skipDirs = new Set([
  '.private',
  'handover',
  'playwright-report',
  '.vercel',
  '.temp',
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'test-results',
  'source-archives',
  '.npm-cache',
]);
const skipNames = new Set([
  '.env',
  '.env.local',
  'CREDENTIALS.txt',
  'ACCOUNT-LOGIN.md',
  'IMAGE-REQUEST-TRANSCRIPTION.md',
  'credentials-and-watcher-reference.png',
  'supabase-handover-reference.png',
  'live-openapi.json',
  'package-inventory.json',
  'package-plan.json',
  'public-client-config.txt',
  'package-result.json',
]);
const files = [];
function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(file);
      continue;
    }
    if (
      skipNames.has(entry.name) ||
      /\.zip$|\.tsbuildinfo$/.test(entry.name) ||
      (entry.name.startsWith('.env.') &&
        !['.env.example', '.env.demo', '.env.v2', '.env.localbackend'].includes(entry.name))
    )
      continue;
    if (/credentials|password|token|secret/i.test(entry.name)) continue;
    const data = fs.readFileSync(file);
    files.push({ file: relative, data });
  }
}
walk(root);
const loaded = parseEnv(fs.readFileSync('.env', 'utf8'));
const vars = Object.fromEntries(
  publicEnvironmentNames
    .filter((name) => loaded[name] !== undefined)
    .map((name) => [name, loaded[name]]),
);
assertPublicEnvironment(vars);
const key = vars.VITE_SUPABASE_ANON_KEY;
if (!key) throw new Error('Public Supabase key missing.');
if (!key.startsWith('sb_publishable_')) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (claims.role !== 'anon') throw new Error('Refusing to package elevated credentials.');
}
if (!/^https:\/\/[^/]+\.supabase\.co$/.test(vars.VITE_SUPABASE_URL))
  throw new Error('Invalid Supabase project URL.');
files.push({
  file: '.env',
  data: Buffer.from(
    '# Public browser configuration only; no account passwords or server secrets.\n' +
      Object.entries(vars)
        .map(([name, value]) => name + '=' + JSON.stringify(value))
        .join('\n') +
      '\n',
  ),
});
// Include only reviewed verification evidence, never private logs or backup data.
for (const folder of [
  'handover/verification/security-2026-10-16',
  'handover/verification/free-security-2026-10-16',
]) {
  if (!fs.existsSync(folder)) continue;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(json|txt|md)$/.test(entry.name)) continue;
    const relative = folder + '/' + entry.name;
    files.push({ file: relative, data: fs.readFileSync(relative) });
  }
}
if (files.some(({ data }) => data.length === 0))
  throw Error('Empty source file found; inspect before packaging.');
const inventory = files.map(({ file, data }) => ({ file, bytes: data.length, sha256: hash(data) }));
const manifest = Buffer.from(
  JSON.stringify(
    {
      files: inventory.length,
      empty_files: inventory.filter((file) => file.bytes === 0),
      inventory,
    },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync('handover/package-inventory.json', manifest);
files.push({ file: 'SOURCE-MANIFEST.json', data: manifest });
if (files.length >= 65535) throw new Error('ZIP64 is required for this many files.');
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const local = [];
const central = [];
let offset = 0;
const names = new Set();
for (const { file, data } of files) {
  if (file.startsWith('/') || file.split('/').includes('..') || names.has(file.toLowerCase()))
    throw new Error('Unsafe/duplicate ZIP name.');
  names.add(file.toLowerCase());
  const name = Buffer.from(file, 'utf8');
  const compressed = deflateRawSync(data, { level: 6 });
  if (hash(inflateRawSync(compressed)) !== hash(data))
    throw new Error('Compression verification failed.');
  if (data.length > 0xffffffff || compressed.length > 0xffffffff || name.length > 65535)
    throw new Error('ZIP64 required.');
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8);
  record.writeUInt16LE(8, 10);
  record.writeUInt16LE(dosTime, 12);
  record.writeUInt16LE(dosDate, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(compressed.length, 20);
  record.writeUInt32LE(data.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(offset, 42);
  central.push(record, name);
  offset += header.length + name.length + compressed.length;
}
const centralData = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralData.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, centralData, end]);
const packageDate =
  process.argv.find((arg) => arg.startsWith('--date='))?.slice(7) ||
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Karachi' });
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(packageDate) ||
  !Number.isFinite(Date.parse(packageDate)) ||
  new Date(packageDate).toISOString().slice(0, 10) !== packageDate
)
  throw new Error('Use a valid YYYY-MM-DD package date.');
const output = path.resolve(root, '../handover/FYP-Compass-LATEST-' + packageDate + '.zip');
fs.mkdirSync(path.dirname(output), { recursive: true });
if (fs.existsSync(output)) {
  const previous = fs.readFileSync(output);
  fs.writeFileSync(
    output.replace(/\.zip$/, '.previous-' + hash(previous).slice(0, 12) + '.zip'),
    previous,
  );
}
fs.writeFileSync(output, zip);
const expected = files.map(({ file, data }) => ({ file, bytes: data.length, sha256: hash(data) }));
fs.writeFileSync(
  'handover/package-plan.json',
  JSON.stringify({ output, files: expected }, null, 2) + '\n',
);
const result = {
  output,
  files: files.length,
  empty_files: files.filter(({ data }) => data.length === 0).length,
  bytes: zip.length,
  sha256: hash(zip),
  compression_roundtrip_verified: true,
  independent_zip_verification: 'pending',
  passwords_included: false,
  server_secrets_included: false,
};
fs.writeFileSync('handover/package-result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
