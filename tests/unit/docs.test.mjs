import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIsalangBlocks, parseFrontmatter, serializeFrontmatter, slugify, validateDoc } from '../../src/lib/docs-shared.js';
import { parseProtocols } from '../../src/lib/protocol.js';
import { readFile } from 'node:fs/promises';

test('extracts isalang blocks with flags and line numbers', () => {
  const md = 'texto\n\n```isalang\nfn main() -> i32 { return 0; }\n```\n\n```isa fail file=x.isa\nfn f() {}\n```\n\n```rust\nfn main(){}\n```\n\n```isalang nocheck\npub fn x(shared self)\n```\n';
  const b = extractIsalangBlocks(md);
  assert.equal(b.length, 3);
  assert.deepEqual([b[0].line, b[0].hasMain, b[0].expectFail], [3, true, false]);
  assert.deepEqual([b[1].expectFail, b[1].file, b[1].hasMain], [true, 'x.isa', false]);
  assert.equal(b[2].skip, true);
});

test('frontmatter round trip', () => {
  const text = serializeFrontmatter({ title: 'Ownership: modos', order: 3, draft: true, description: undefined });
  const { data, body } = parseFrontmatter(text + '\ncorpo');
  assert.deepEqual(data, { title: 'Ownership: modos', order: 3, draft: true });
  assert.equal(body.trim(), 'corpo');
  assert.deepEqual(validateDoc(data), []);
  assert.ok(validateDoc({}).length);
});

test('slugify removes accents and punctuation', () => {
  assert.equal(slugify('Referência: Vec<T> e Box!'), 'referencia-vec-t-e-box');
});


test('parses the protocol of examples/connection.isa', async () => {
  const [p] = parseProtocols(await readFile(new URL('../../examples/connection.isa', import.meta.url), 'utf8'));
  assert.equal(p.name, 'ConnectionState');
  assert.equal(p.initial, 'Disconnected');
  assert.deepEqual(p.states.map(s => s.name), ['Disconnected', 'Connected', 'Authenticated']);
  const connected = p.states[1];
  assert.deepEqual(connected.ops.find(o => o.name === 'send'), { name: 'send', access: 'shared', to: 'Connected' });
  assert.deepEqual(connected.ops.find(o => o.name === 'authenticate'), { name: 'authenticate', access: 'own', to: 'Authenticated' });
});
