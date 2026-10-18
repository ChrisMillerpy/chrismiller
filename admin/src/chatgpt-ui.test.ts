import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CHATGPT_BODY, CHATGPT_JS } from './chatgpt-ui.ts';

test('the page script is valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(CHATGPT_JS));
});

test('everything the script looks up is on the page', () => {
  const ids = [...CHATGPT_JS.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 5);
  for (const id of new Set(ids)) assert.match(CHATGPT_BODY, new RegExp(`id="${id}"`), `no #${id} on the page`);
});

test('whatever the server sends is shown as text, never as HTML', () => {
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.ok(!CHATGPT_JS.includes(bad), bad);
});

test('it only calls the ChatGPT endpoints through admin, and every POST says it is JSON', () => {
  assert.deepEqual([...CHATGPT_JS.matchAll(/'(\/api\/[^']*)'/g)].map((m) => m[1]), ['/api/cathy/chatgpt'], 'one base address, nothing else');
  assert.ok(!/fetch\((?!API)/.test(CHATGPT_JS), 'every fetch goes through API');
  const paths = [...CHATGPT_JS.matchAll(/call\('([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(paths)].sort(), ['', '/finish', '/start', '/test']);
  const posts = CHATGPT_JS.match(/method: 'POST'/g)?.length ?? 0;
  const typed = CHATGPT_JS.match(/headers: JSON_HEADERS/g)?.length ?? 0;
  assert.equal(posts, 3);
  assert.equal(typed, posts, 'each POST sends content-type: application/json');
});

test('disconnecting asks first', () => {
  assert.match(CHATGPT_JS, /confirm\(/);
});

test('the page explains the odd "can\'t be reached" step, and points at the privacy setting', () => {
  assert.match(CHATGPT_BODY, /can.t be reached/i);
  assert.match(CHATGPT_BODY, /address bar/i);
  assert.match(CHATGPT_BODY, /Improve the model/i);
});
