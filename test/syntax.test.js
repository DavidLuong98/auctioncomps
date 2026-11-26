// The UI script lives inline in index.html; compile it (without running it) to catch syntax errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('inline script in index.html compiles', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  // every inline script (any attributes, but no src=)
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0, 'found an inline script');
  for (const src of scripts) new vm.Script(src, { filename: 'index.html' });
});
