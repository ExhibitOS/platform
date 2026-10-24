// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntimeNetwork, startLocalRuntime} from './local-runtime.mjs';

test('native services bind loopback on the actual user origin without container mapping', () => {
  assert.deepEqual(localRuntimeNetwork({EXHIBITOS_RUNTIME_MODE:'native'}), {
    mode:'native',port:13200,apiPort:13201,proxyPort:13200,proxyHost:'127.0.0.1'
  });
  assert.deepEqual(localRuntimeNetwork({EXHIBITOS_RUNTIME_MODE:'native',EXHIBITOS_PORT:'14500',EXHIBITOS_API_PORT:'14501'}), {
    mode:'native',port:14500,apiPort:14501,proxyPort:14500,proxyHost:'127.0.0.1'
  });
  assert.deepEqual(localRuntimeNetwork({}), {
    mode:'container',port:13200,apiPort:3000,proxyPort:8080,proxyHost:'0.0.0.0'
  });
});

test('invalid native ports/mode fail before DB access, migrations or credential setup', async () => {
  for (const fields of [
    {EXHIBITOS_PORT:'13201'}, {EXHIBITOS_API_PORT:'0'}, {EXHIBITOS_API_PORT:'1023'},
    {EXHIBITOS_PORT:'65536'}, {EXHIBITOS_API_PORT:'13201.5'},
    {EXHIBITOS_PORT:' 13200'}, {EXHIBITOS_API_PORT:'013201'},
    {EXHIBITOS_RUNTIME_MODE:'unexpected'}
  ]) {
    const environment = {EXHIBITOS_RUNTIME_MODE:'native',...fields};
    assert.throws(() => localRuntimeNetwork(environment), /LOCAL_(?:CONFIGURATION|RUNTIME_MODE)_INVALID/);
    await assert.rejects(startLocalRuntime(environment), /LOCAL_(?:CONFIGURATION|RUNTIME_MODE)_INVALID/);
  }
});
