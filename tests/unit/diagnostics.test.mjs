import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagnostics } from '../../src/lab/engine/compiler.js';
import examples from '../../src/data/lab-examples.json' with { type: 'json' };

test('parses the real E0301 diagnostic', () => {
  const ex = examples.entries.find(e => e.id === 'string_move_invalid.isa');
  const [d] = parseDiagnostics(ex.diagnostics);
  assert.equal(d.code, 'E0301');
  assert.equal(d.severity, 'error');
  assert.equal(d.file, 'string_move_invalid.isa');
  assert.equal(d.line, 4);
  assert.equal(d.column, 9);
  assert.match(d.message, /moved value/);
  assert.ok(d.notes.some(n => n.startsWith('help:')));
});

test('strips ANSI colors and the /work prefix', () => {
  const [d] = parseDiagnostics('\x1b[1;31merror[E0002]\x1b[0m: expected expression\n  --> /work/a/b.isa:2:5\n');
  assert.equal(d.code, 'E0002');
  assert.equal(d.file, 'a/b.isa');
  assert.equal(d.line, 2);
});

test('every rejected example produces at least one located diagnostic', () => {
  for (const ex of examples.entries.filter(e => e.status === 'rejected')) {
    const list = parseDiagnostics(ex.diagnostics);
    assert.ok(list.length > 0 && list[0].line > 0, ex.id);
  }
});
