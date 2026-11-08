// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseStaticJson } from './static-json.mjs';

const bytes = (value: string) => new TextEncoder().encode(value);

describe('bounded static JSON ingress', () => {
  it('accepts ordinary nested documents and escaped string content', () => {
    const input = JSON.stringify({text:'a"}\\b',items:[null,true,-150,{x:1}]});
    expect(parseStaticJson(bytes(input))).toEqual(JSON.parse(input));
  });

  it('rejects duplicate keys including escaped names at any depth', () => {
    for (const input of ['{"x":1,"x":2}', '{"a":[{"x":1,"\\u0078":2}]}', '{"a":{},"\\u0061":{}}']) {
      expect(() => parseStaticJson(bytes(input))).toThrow('STATIC_JSON_INVALID');
    }
    expect(parseStaticJson(bytes('{"a":{"x":1},"b":{"x":2}}'))).toEqual({a:{x:1},b:{x:2}});
  });

  it('rejects malformed JSON, invalid UTF-8 and excessive size or depth', () => {
    for (const input of ['{"x":1,}', '[1,]', '[01]', '"\\q"', 'true false', '['.repeat(130)+']'.repeat(130)]) {
      expect(() => parseStaticJson(bytes(input))).toThrow('STATIC_JSON_INVALID');
    }
    expect(() => parseStaticJson(new Uint8Array([0xc3,0x28]))).toThrow('STATIC_JSON_INVALID');
    expect(() => parseStaticJson(bytes('{}'), 1)).toThrow('STATIC_JSON_SIZE');
  });
});
