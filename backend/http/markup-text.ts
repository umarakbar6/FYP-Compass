// Plain-text extraction only. This is not an HTML sanitizer or an XML parser.
// Callers bound input bytes and render the result as text, never trusted markup.
export function stripMarkup(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('<', cursor);
    if (open < 0) break;
    const close = text.indexOf('>', open + 1);
    // Stop after the first unterminated tag; do not retry from every '<'.
    if (close < 0) break;
    parts.push(text.slice(cursor, open), ' ');
    cursor = close + 1;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}
