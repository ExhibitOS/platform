// SPDX-License-Identifier: AGPL-3.0-or-later
// Check raw keys before JSON.parse can discard duplicates. Bounds apply before
// walking the document, including to documents with deeply nested empty arrays.
export function parseStaticJson(bytes, limit = 1048576) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > limit) throw Error('STATIC_JSON_SIZE');
  let source;
  try { source = new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { throw Error('STATIC_JSON_INVALID'); }
  let pos = 0, nodes = 0;
  const primitive = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
  const invalid = () => { throw Error('STATIC_JSON_INVALID'); };
  const space = () => { while (/[\t\n\r ]/.test(source[pos] ?? '\0')) pos++; };
  function string() {
    const start = pos++;
    while (pos < source.length) {
      const char = source[pos++];
      if (char === '"') {
        try { return JSON.parse(source.slice(start, pos)); } catch { return invalid(); }
      }
      if (char === '\\') pos++;
    }
    return invalid();
  }
  function value(depth) {
    if (depth > 128 || ++nodes > 100000) return invalid();
    space();
    const char = source[pos];
    if (char === '"') { string(); return; }
    if (char === '{') {
      pos++; space();
      if (source[pos] === '}') { pos++; return; }
      const keys = new Set();
      for (;;) {
        if (source[pos] !== '"') return invalid();
        const key = string();
        if (keys.has(key)) return invalid();
        keys.add(key); space();
        if (source[pos++] !== ':') return invalid();
        value(depth + 1); space();
        const next = source[pos++];
        if (next === '}') return;
        if (next !== ',') return invalid();
        space();
      }
    }
    if (char === '[') {
      pos++; space();
      if (source[pos] === ']') { pos++; return; }
      for (;;) {
        value(depth + 1); space();
        const next = source[pos++];
        if (next === ']') return;
        if (next !== ',') return invalid();
      }
    }
    primitive.lastIndex = pos;
    const match = primitive.exec(source);
    if (!match) return invalid();
    pos += match[0].length;
  }
  value(0); space();
  if (pos !== source.length) return invalid();
  try { return JSON.parse(source); } catch { return invalid(); }
}
