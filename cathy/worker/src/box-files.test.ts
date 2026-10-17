import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachToBox, publishFromBox } from './box-files.ts';
import { Registry, uploadKey } from './registry.ts';
import { fakeD1, fakeR2, SCHEMA } from './test-fakes.ts';
import type { Box } from '../../agent/box.ts';

function memBox(files: Record<string, Uint8Array> = {}) {
  const fs = new Map(Object.entries(files));
  const box: Box = {
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    readFile: async (p) => new TextDecoder().decode(fs.get(p)),
    writeFile: async (p, c) => void fs.set(p, new TextEncoder().encode(c)),
    readBytes: async (p) => {
      if (!fs.has(p)) throw new Error(`No such file: ${p}`);
      return fs.get(p)!;
    },
    writeBytes: async (p, b) => void fs.set(p, b),
  };
  return { box, fs };
}
const enc = (s: string) => new TextEncoder().encode(s);
const share = { SHARE_URL: 'https://share.test' };

test('publishFromBox reads the file, picks its type from the name, and returns links', async () => {
  const reg = new Registry(fakeD1(), SCHEMA, fakeR2());
  const { box } = memBox({ '/tmp/sheet.md': enc('# Hi') });
  const a = await publishFromBox(reg, box, 's1', share, { path: '/tmp/sheet.md', title: 'Sheet' });
  assert.equal(a.filename, 'sheet.md');
  assert.match(a.mime, /^text\/markdown/);
  assert.equal(a.visibility, 'private');
  assert.equal(a.version, 1);
  assert.equal(a.admin_url, `/artifacts/${a.id}`);
  assert.match(a.share_url, /^https:\/\/share\.test\/a\/[a-z0-9]{20}$/);
});

test('publishFromBox with an id adds a version to that artifact', async () => {
  const reg = new Registry(fakeD1(), SCHEMA, fakeR2());
  const { box, fs } = memBox({ 'a.html': enc('one') });
  const first = await publishFromBox(reg, box, 's1', share, { path: 'a.html', title: 'A' });
  fs.set('a.html', enc('two'));
  const second = await publishFromBox(reg, box, 's1', share, { path: 'a.html', title: 'A', id: first.id });
  assert.equal(second.id, first.id);
  assert.equal(second.version, 2);
  assert.equal(second.share_url, first.share_url);
});

test('publishFromBox explains what went wrong: unknown id, missing file, too big', async () => {
  const reg = new Registry(fakeD1(), SCHEMA, fakeR2());
  const { box } = memBox({ 'big.bin': new Uint8Array(26 * 1024 * 1024) });
  await assert.rejects(publishFromBox(reg, box, 's1', share, { path: 'x', title: 'X', id: 'nope' }), /No artifact nope\. Use list_artifacts/);
  await assert.rejects(publishFromBox(reg, box, 's1', share, { path: 'missing.txt', title: 'X' }), /No such file/);
  await assert.rejects(publishFromBox(reg, box, 's1', share, { path: 'big.bin', title: 'X' }), /26\.0 MB; artifacts can be up to 25 MB/);
  assert.equal((await reg.artifacts()).length, 0, 'nothing half-published');
});

test("publishFromBox won't update another chat's artifact", async () => {
  const reg = new Registry(fakeD1(), SCHEMA, fakeR2());
  const { box } = memBox({ 'a.html': enc('x') });
  const theirs = await publishFromBox(reg, box, 'other', share, { path: 'a.html', title: 'Theirs' });
  await assert.rejects(publishFromBox(reg, box, 's1', share, { path: 'a.html', title: 'Mine', id: theirs.id }), /belongs to another chat/);
});

test('attachToBox writes each upload under /uploads/<id>/<name> and returns its bytes', async () => {
  const reg = new Registry(fakeD1(), SCHEMA, fakeR2());
  const u = await reg.addUpload('s1', 'graph.png', 'image/png', new Uint8Array([1, 2, 3]));
  const { box, fs } = memBox();
  const [a] = await attachToBox(reg, box, [{ id: u.id, name: u.name, mime: u.mime, size: u.size }]);
  assert.equal(a.path, `/uploads/${u.id}/graph.png`);
  assert.deepEqual(a.bytes, new Uint8Array([1, 2, 3]));
  assert.deepEqual(fs.get(a.path), new Uint8Array([1, 2, 3]));
});

test('attachToBox fails clearly if a file has gone from storage', async () => {
  const reg = new Registry(fakeD1(), SCHEMA, fakeR2());
  const { box } = memBox();
  await assert.rejects(attachToBox(reg, box, [{ id: 'gone123456', name: 'x.png', mime: 'image/png', size: 3 }]), /x\.png is missing from storage/);
  assert.equal(uploadKey('a'), 'uploads/a');
});
