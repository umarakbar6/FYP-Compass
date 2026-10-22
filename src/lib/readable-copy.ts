// Display formatting only, never an email validator or an HTML sanitizer.
// Classify whitespace tokens once so long plain text cannot trigger quadratic
// retries of an unanchored email/filename regular expression.
export function readableCopy(text: string): string {
  const narrative = (value: string) =>
    value.replace(/(\p{L})\s*[-\u2010-\u2014]+\s*(?=\p{L})/gu, '$1 ');
  let output = '',
    cursor = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    const token = match[0],
      at = token.indexOf('@'),
      dot = token.indexOf('.', at + 1);
    const emailLike =
      at > 0 && token.indexOf('@', at + 1) === -1 && dot > at + 1 && dot < token.length - 1;
    const canonicalId = /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i.test(token);
    const documentName = /\.(?:pdf|docx|zip|csv|json|md|txt)\b/i.test(token);
    if (token.includes('/') || emailLike || canonicalId || documentName) {
      output += narrative(text.slice(cursor, match.index)) + token;
      cursor = match.index + token.length;
    }
  }
  return output + narrative(text.slice(cursor));
}
