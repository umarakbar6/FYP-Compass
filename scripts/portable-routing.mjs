// Vercel rewrites vercel.json and may inject build metadata. Compare the public
// routing/security controls by meaning; never publish injected environment data.
export function canonicalPublicRouting(config) {
  const allowed = [
    'framework',
    'installCommand',
    'buildCommand',
    'outputDirectory',
    'rewrites',
    'headers',
    'functions',
  ];
  return JSON.stringify(
    Object.fromEntries(
      allowed.filter((name) => config[name] !== undefined).map((name) => [name, config[name]]),
    ),
    (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : value,
  );
}
