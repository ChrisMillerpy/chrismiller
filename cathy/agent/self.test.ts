import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { loadSelf, instructions, parseFrontmatter } from './self.ts';
import { createCathy } from './cathy.ts';
import { fakeModel } from './fake-model.ts';
import type { Box } from './box.ts';

/** A box over a Map of files; `ls` lists the folders under a prefix. */
function mapBox(files: Record<string, string>): Box {
  return {
    async run(command) {
      const m = command.match(/^ls -1 (\S+)/);
      if (!m) return { exitCode: 0, stdout: '', stderr: '' };
      const names = new Set(Object.keys(files).filter((p) => p.startsWith(`${m[1]}/`)).map((p) => p.slice(m[1].length + 1).split('/')[0]));
      return names.size ? { exitCode: 0, stdout: [...names].join('\n'), stderr: '' } : { exitCode: 2, stdout: '', stderr: '' };
    },
    async readFile(path) {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path];
    },
    async writeFile(path, content) {
      files[path] = content;
    },
  };
}

test('frontmatter: name and description, quoted or not', () => {
  assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: "Do the thing"\n---\nbody'), { name: 'a', description: 'Do the thing' });
  assert.deepEqual(parseFrontmatter('no frontmatter'), {});
});

test('loads soul, memory index and skill descriptions', async () => {
  const box = mapBox({
    'cathy/self/SOUL.md': 'I am Cathy.',
    'cathy/self/memory/INDEX.md': '- [Chris](chris.md): prefs',
    'cathy/self/skills/blog/SKILL.md': '---\nname: blog\ndescription: Write a post\n---\nSteps…',
    'cathy/self/skills/notes/readme.txt': 'not a skill',
  });
  const self = await loadSelf(box);
  assert.equal(self.soul, 'I am Cathy.');
  assert.deepEqual(self.skills, [{ name: 'blog', description: 'Write a post', path: 'cathy/self/skills/blog/SKILL.md' }]);
  const text = instructions('abc', 'cathy/abc', self);
  for (const want of ['I am Cathy.', 'abc', 'cathy/abc', 'prefs', 'Write a post', 'cathy/self/skills/blog/SKILL.md']) assert.ok(text.includes(want), want);
});

test('missing files do not break her', async () => {
  const self = await loadSelf(mapBox({}));
  const text = instructions('s', 'cathy/s', self);
  assert.match(text, /SOUL\.md is missing/);
  assert.match(text, /\(none yet\)/);
});

test('an edit she commits is in her instructions on the next turn', async () => {
  const files: Record<string, string> = { 'cathy/self/SOUL.md': 'v1', 'cathy/self/memory/INDEX.md': '' };
  const box = mapBox(files);
  const model = fakeModel([{ text: 'a' }, { text: 'b' }]);
  const cathy = createCathy({ model: model as any, box, sessionId: 's', branch: 'cathy/s' });
  await (await cathy.stream([{ role: 'user', content: 'hi' }])).text;
  await box.writeFile('cathy/self/memory/INDEX.md', '- [New](new.md): a fresh note');
  await (await cathy.stream([{ role: 'user', content: 'hi again' }])).text;
  assert.doesNotMatch(JSON.stringify(model.calls[0]), /fresh note/);
  assert.match(JSON.stringify(model.calls[1]), /fresh note/);
});

test('the real cathy/self files are well formed', async () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  assert.match(read('cathy/self/SOUL.md'), /Never merge/);
  const index = read('cathy/self/memory/INDEX.md');
  for (const [, file] of index.matchAll(/\]\(([^)]+\.md)\)/g)) assert.ok(read(`cathy/self/memory/${file}`).length > 0, `${file} is listed in INDEX.md but empty`);
  const fm = parseFrontmatter(read('cathy/self/skills/edit-yourself/SKILL.md'));
  assert.equal(fm.name, 'edit-yourself');
  assert.ok(fm.description);
});

test('every real skill has a name matching its folder and a one-line description', () => {
  for (const folder of readdirSync('cathy/self/skills')) {
    const fm = parseFrontmatter(readFileSync(`cathy/self/skills/${folder}/SKILL.md`, 'utf8'));
    assert.equal(fm.name, folder, `${folder}: name`);
    assert.ok(fm.description && fm.description.length < 200 && !fm.description.includes('\n'), `${folder}: description`);
  }
});

test('the artifacts skill covers publishing, privacy and versions', () => {
  const skill = readFileSync('cathy/self/skills/artifacts/SKILL.md', 'utf8');
  assert.match(parseFrontmatter(skill).description, /artifact/i);
  for (const must of [/publish_artifact/, /private/i, /link/i, /student or parent/i, /list_artifacts/, /\bid\b/, /Markdown/, /\$\$/]) assert.match(skill, must);
});

test('the sub-agents skill covers when to split, the modes, models, file ownership, merging and limits', () => {
  const skill = readFileSync('cathy/self/skills/sub-agents/SKILL.md', 'utf8');
  assert.match(parseFrontmatter(skill).description, /sub-agent/i);
  for (const must of [/spawn_agent/, /list_agents/, /message_agent/, /stop_agent/, /fresh/, /fork/, /custom/, /model/i, /separate files/i, /git merge/, /open_pr/, /report/i, /student or parent/i]) assert.match(skill, must);
});
