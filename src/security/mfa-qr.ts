// Supabase SDK versions return raw SVG or an SVG data URI. Never log this value.
export function normaliseTotpQr(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2 * 1024 * 1024)
    throw Error('The authenticator QR code is invalid. Clear the unfinished setup and retry.');
  let svg = value.trim();
  try {
    if (svg.startsWith('data:image/svg+xml')) {
      const comma = svg.indexOf(',');
      if (comma < 0) throw Error();
      const header = svg.slice(0, comma),
        payload = svg.slice(comma + 1);
      svg = /;base64$/i.test(header)
        ? atob(payload)
        : payload.trim().startsWith('<')
          ? payload
          : decodeURIComponent(payload);
    } else if (!/^<(?:svg\b|\?xml\b)/i.test(svg)) throw Error();
    if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(svg)) throw Error();
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (
      document.documentElement.localName !== 'svg' ||
      document.querySelector('parsererror') ||
      /<!DOCTYPE|<!ENTITY/i.test(svg)
    )
      throw Error();
    const forbidden = new Set([
      'script',
      'foreignobject',
      'iframe',
      'object',
      'embed',
      'image',
      'use',
      'a',
      'animate',
      'animatetransform',
      'set',
    ]);
    for (const node of document.querySelectorAll('*')) {
      if (forbidden.has(node.localName.toLowerCase())) throw Error();
      if (
        node.localName.toLowerCase() === 'style' &&
        /url\s*\(|@import|expression\s*\(/i.test(node.textContent || '')
      )
        throw Error();
      for (const attr of node.attributes) {
        if (/^on|href$/i.test(attr.name) || /url\s*\(|javascript:/i.test(attr.value)) throw Error();
      }
    }
    // Use an encoded image source; no HTML insertion or external resource loads.
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch {
    throw Error('The authenticator QR code is invalid. Clear the unfinished setup and retry.');
  }
}
