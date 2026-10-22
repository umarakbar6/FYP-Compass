import { inspectDocument } from '../security/documents';
import { zipSync, strToU8 as encode, zlibSync } from 'fflate';
// Coerce host TextEncoder output into the test realm so ZIP bytes are encoded as files, not nested object directories.
const strToU8 = (value: string) => new Uint8Array(encode(value));
const pdf = (extra = '') =>
  strToU8('%PDF-1.7\n1 0 obj << /Type /Catalog ' + extra + ' >> endobj\n%%EOF\n');
const docx = (extras: Record<string, Uint8Array> = {}) =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<document><p>Academic evidence</p></document>'),
    ...extras,
  });
it('accepts plain PDF and DOCX bytes rather than trusting browser MIME', () => {
  expect(inspectDocument(pdf(), 'report.pdf').mime).toBe('application/pdf');
  expect(inspectDocument(docx(), 'report.docx').method).toBe('screen_v1');
});
it('rejects empty, oversized and legacy executable-looking uploads', () => {
  for (const [bytes, name] of [
    [new Uint8Array(), 'a.pdf'],
    [new Uint8Array(10485761), 'a.pdf'],
    [strToU8('MZ'), 'a.doc'],
    [pdf(), '../a.pdf'],
  ] as const)
    expect(() => inspectDocument(bytes, name)).toThrow();
});
it('rejects disguised and truncated PDFs', () => {
  expect(() => inspectDocument(strToU8('not a PDF'), 'a.pdf')).toThrow();
  expect(() => inspectDocument(strToU8('%PDF-1.7\ntruncated'), 'a.pdf')).toThrow();
  expect(() => inspectDocument(pdf('stream\n'.repeat(20000)), 'a.pdf')).toThrow(
    /stream is incomplete/,
  );
});
it('rejects escaped PDF JavaScript, launch, embedded files and actions', () => {
  for (const name of ['JavaScript', 'J#53', 'Launch', 'EmbeddedFile', 'OpenAction', 'AA'])
    expect(() => inspectDocument(pdf('/' + name + ' 2 0 R'), 'a.pdf')).toThrow(/active|embedded/);
});
it('rejects compressed active PDF object streams', () => {
  const compressed = zlibSync(strToU8('<< /JavaScript (payload) >>'));
  const head = strToU8('%PDF-1.7\n1 0 obj << /Type /ObjStm /Filter /FlateDecode >>\nstream\n'),
    tail = strToU8('\nendstream\nendobj\n%%EOF');
  const all = new Uint8Array(head.length + compressed.length + tail.length);
  all.set(head);
  all.set(compressed, head.length);
  all.set(tail, head.length + compressed.length);
  expect(() => inspectDocument(all, 'a.pdf')).toThrow(/compressed active/);
});
it('rejects macros, embedded objects and executable DOCX parts', () => {
  for (const name of [
    'word/vbaProject.bin',
    'word/embeddings/object.dat',
    'word/activeX/a.xml',
    'payload.exe',
  ])
    expect(() => inspectDocument(docx({ [name]: strToU8('payload') }), 'a.docx')).toThrow();
});
it('rejects external links, XML entities and DDE fields', () => {
  for (const text of [
    '<Relationship TargetMode="External"/>',
    '<!DOCTYPE document>',
    '<!ENTITY x "a">',
    '<field>DDEAUTO</field>',
  ])
    expect(() =>
      inspectDocument(docx({ 'word/_rels/document.xml.rels': strToU8(text) }), 'a.docx'),
    ).toThrow();
});
it('rejects path traversal, duplicate folded names and missing document structure', () => {
  expect(() => inspectDocument(docx({ '../outside.xml': strToU8('x') }), 'a.docx')).toThrow();
  expect(() => inspectDocument(docx({ 'WORD/DOCUMENT.XML': strToU8('x') }), 'a.docx')).toThrow();
  expect(() => inspectDocument(zipSync({ 'x.xml': strToU8('x') }), 'a.docx')).toThrow();
});
it('rejects excessive compression ratios before inflating', () => {
  expect(() =>
    inspectDocument(docx({ 'word/large.xml': new Uint8Array(2 * 1024 * 1024) }), 'a.docx'),
  ).toThrow();
});
it('rejects forged central sizes and mismatched local archive names', () => {
  const bytes = docx();
  const view = new DataView(bytes.buffer);
  let central = -1;
  for (let i = 0; i < bytes.length - 4; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      central = i;
      break;
    }
  const forged = bytes.slice();
  new DataView(forged.buffer).setUint32(central + 24, 1, true);
  expect(() => inspectDocument(forged, 'a.docx')).toThrow();
  const zip64 = bytes.slice();
  new DataView(zip64.buffer).setUint32(central + 20, 0xffffffff, true);
  expect(() => inspectDocument(zip64, 'a.docx')).toThrow();
  const altered = bytes.slice();
  altered[30] = 88;
  expect(() => inspectDocument(altered, 'a.docx')).toThrow();
});
