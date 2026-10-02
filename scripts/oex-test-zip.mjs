// SPDX-License-Identifier: AGPL-3.0-or-later
// Independent test-only ZIP writer; deliberately permits invalid names/duplicates.
import { inflateRawSync, deflateRawSync } from "node:zlib";
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
export function fixtureZip(entries, { deflate = false } = {}) {
  const chunks = [], records = []; let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(value), checksum = crc32(bytes), stored = deflate ? deflateRawSync(bytes) : bytes;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(stored.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    chunks.push(local, filename, stored);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(stored.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    records.push(central, filename); offset += local.length + filename.length + stored.length;
  }
  const directory = Buffer.concat(records), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
/** Only use on the application's own valid export. Not an untrusted ZIP parser. */
export function exportedEntries(bytes) {
  const output = []; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8), length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString("utf8", offset + 30, offset + 30 + nameLength), start = offset + 30 + nameLength + extra;
    const raw = bytes.subarray(start, start + length);
    output.push([name, method === 8 ? inflateRawSync(raw, { maxOutputLength: 32 * 1024 * 1024 }) : Buffer.from(raw)]);
    offset = start + length;
  }
  return output;
}
