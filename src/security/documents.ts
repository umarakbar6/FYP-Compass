import { Unzip, UnzipInflate, Unzlib } from 'fflate';
const MAX_BYTES = 10 * 1024 * 1024,
  MAX_EXPANDED = 32 * 1024 * 1024;
const ascii = (bytes: Uint8Array) => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return result;
};
const deny = (message: string): never => {
  throw new Error(message);
};
function activePdf(text: string) {
  const decoded = text.replace(/#([a-f0-9]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  return /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|OpenAction|AA)\b/i.test(decoded);
}
export function inspectDocument(
  bytes: Uint8Array,
  name: string,
): { mime: string; method: 'screen_v1' } {
  if (!bytes.length || bytes.length > MAX_BYTES)
    deny('Choose a document with content, up to 10 MB.');
  if (name.length > 255 || /[\\/:\u0000-\u001f]/.test(name) || !name.trim())
    deny('Document name is invalid.');
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') {
    const raw = ascii(bytes);
    if (!/^%PDF-(1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(raw) || !raw.slice(-2048).includes('%%EOF'))
      deny('The file is not a complete PDF.');
    if (activePdf(raw) || /EICAR-STANDARD-ANTIVIRUS-TEST-FILE/.test(raw))
      deny('This PDF contains active or embedded content. Export a plain PDF and retry.');
    // Inspect Flate-compressed object streams too, with a shared expansion ceiling.
    let expanded = 0,
      streams = 0;
    const pattern = /\bstream\r?\n/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw))) {
      const dataStart = match.index + match[0].length,
        end = raw.indexOf('\nendstream', dataStart);
      if (end < 0) deny('PDF stream is incomplete. Export a plain PDF and retry.');
      const dataEnd = raw[end - 1] === '\r' ? end - 1 : end;
      pattern.lastIndex = end + 10;
      if (++streams > 1000) deny('PDF contains too many streams.');
      const dictionary = raw.slice(Math.max(0, match.index - 1024), match.index);
      if (/\/FlateDecode\b/.test(dictionary)) {
        const parts: Uint8Array[] = [];
        let error = false;
        const inflater = new Unzlib((chunk) => {
          expanded += chunk.length;
          if (expanded > MAX_EXPANDED) deny('PDF expanded content exceeds the safety limit.');
          parts.push(chunk);
        });
        const compressed = Uint8Array.from(raw.slice(dataStart, dataEnd), (c) => c.charCodeAt(0));
        try {
          for (let i = 0; i < compressed.length; i += 256)
            inflater.push(compressed.subarray(i, i + 256), i + 256 >= compressed.length);
        } catch (cause) {
          if (cause instanceof Error && cause.message.includes('safety limit')) throw cause;
          error = true;
        }
        if (error && /\/ObjStm\b/.test(dictionary))
          deny('PDF object streams could not be safely inspected.');
        if (!error && activePdf(parts.map(ascii).join('')))
          deny('This PDF contains compressed active content. Export a plain PDF and retry.');
      } else if (/\/ObjStm\b/.test(dictionary))
        deny('PDF object compression is unsupported for safe inspection.');
    }
    return { mime: 'application/pdf', method: 'screen_v1' };
  }
  if (extension === 'docx') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50)
      deny('The file is not a DOCX document.');
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
      if (view.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0)
      deny('DOCX archive is incomplete or unsupported.');
    const count = view.getUint16(end + 10, true),
      directorySize = view.getUint32(end + 12, true),
      directoryStart = view.getUint32(end + 16, true);
    if (count < 1 || count > 500 || directoryStart + directorySize > end)
      deny('DOCX archive limits exceeded.');
    let at = directoryStart,
      total = 0;
    const names = new Set<string>();
    const expected = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
        deny('DOCX archive structure is invalid.');
      const flags = view.getUint16(at + 8, true),
        method = view.getUint16(at + 10, true),
        packed = view.getUint32(at + 20, true),
        size = view.getUint32(at + 24, true),
        length = view.getUint16(at + 28, true),
        extra = view.getUint16(at + 30, true),
        comment = view.getUint16(at + 32, true),
        offset = view.getUint32(at + 42, true);
      if (
        at + 46 + length + extra + comment > end ||
        offset + 30 > directoryStart ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        size > 8 * 1024 * 1024 ||
        (size > 1024 * 1024 && size / Math.max(packed, 1) > 200)
      )
        deny('DOCX encrypted, oversized or unsafe archive entry.');
      const path = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(at + 46, at + 46 + length),
      );
      if (
        path.startsWith('/') ||
        path.includes('\\') ||
        path.includes(':') ||
        path.split('/').includes('..') ||
        names.has(path.toLowerCase())
      )
        deny('DOCX contains unsafe or duplicate paths.');
      const localLength = view.getUint16(offset + 26, true),
        localExtra = view.getUint16(offset + 28, true);
      if (
        view.getUint32(offset, true) !== 0x04034b50 ||
        view.getUint16(offset + 6, true) !== flags ||
        view.getUint16(offset + 8, true) !== method ||
        offset + 30 + localLength + localExtra + packed > directoryStart
      )
        deny('DOCX local archive entry is invalid.');
      const localPath = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(offset + 30, offset + 30 + localLength),
      );
      if (localPath !== path) deny('DOCX archive names do not match.');
      expected.set(path, size);
      names.add(path.toLowerCase());
      total += size;
      if (total > MAX_EXPANDED) deny('DOCX expanded content exceeds the safety limit.');
      at += 46 + length + extra + comment;
    }
    if (
      at !== directoryStart + directorySize ||
      !names.has('[content_types].xml') ||
      !names.has('word/document.xml')
    )
      deny('DOCX is missing its document structure.');
    // Stream inflation in bounded input chunks; forged size fields cannot allocate an unbounded output.
    const entries: Record<string, Uint8Array> = {};
    let actualTotal = 0;
    const visited = new Set<string>();
    const unzip = new Unzip((file) => {
      const declared = expected.get(file.name);
      if (declared === undefined || visited.has(file.name))
        return deny('DOCX unexpected archive entry.');
      visited.add(file.name);
      const chunks: Uint8Array[] = [];
      let length = 0;
      file.ondata = (error, chunk, final) => {
        if (error) deny('DOCX compressed data is invalid.');
        length += chunk.length;
        actualTotal += chunk.length;
        if (length > declared || length > 8 * 1024 * 1024 || actualTotal > MAX_EXPANDED) {
          file.terminate();
          deny('DOCX expanded content exceeds the safety limit.');
        }
        chunks.push(chunk);
        if (final) {
          if (length !== declared) deny('DOCX archive sizes do not match.');
          const output = new Uint8Array(length);
          let pos = 0;
          for (const part of chunks) {
            output.set(part, pos);
            pos += part.length;
          }
          entries[file.name] = output;
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    try {
      for (let pos = 0; pos < bytes.length; pos += 256)
        unzip.push(bytes.subarray(pos, pos + 256), pos + 256 >= bytes.length);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('DOCX')) throw error;
      deny('DOCX compressed data is invalid.');
    }
    if (visited.size !== expected.size || Object.keys(entries).length !== expected.size)
      deny('DOCX archive is incomplete.');
    for (const [path, value] of Object.entries(entries)) {
      if (/vbaproject|activex|(^|\/)embeddings\/|\.(exe|dll|js|vbs|ps1|bin)$/i.test(path))
        deny('DOCX macros, executable or embedded content is not allowed.');
      if (/\.xml$|\.rels$/i.test(path)) {
        const text = new TextDecoder().decode(value);
        if (
          /<!DOCTYPE|<!ENTITY|macroEnabled|TargetMode\s*=\s*['"]External|\b(DDEAUTO|DDE)\b|EICAR-STANDARD-ANTIVIRUS-TEST-FILE/i.test(
            text,
          )
        )
          deny('DOCX active content or external relationships are not allowed.');
      }
    }
    return {
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      method: 'screen_v1',
    };
  }
  return deny('Use PDF or DOCX. Convert legacy DOC files before uploading.');
}
