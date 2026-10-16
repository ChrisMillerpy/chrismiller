import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { gitAuthEnv } from './git-auth.ts';

test('no token: nothing added', () => {
  assert.deepEqual(gitAuthEnv(undefined), {});
  assert.deepEqual(gitAuthEnv(''), {});
});

test('with a token: gh gets GH_TOKEN', () => {
  assert.equal(gitAuthEnv('tok123').GH_TOKEN, 'tok123');
});

test('with a token: real git sends it for github.com, without writing it to any config file', () => {
  const env = { ...process.env, ...gitAuthEnv('tok123'), GIT_CONFIG_NOSYSTEM: '1', HOME: '/nonexistent' };
  const url = execFileSync('git', ['ls-remote', '--get-url', 'https://github.com/ChrisMillerpy/chrismiller'], { env }).toString().trim();
  assert.equal(url, 'https://x-access-token:tok123@github.com/ChrisMillerpy/chrismiller');
});

test('other hosts are left alone', () => {
  const env = { ...process.env, ...gitAuthEnv('tok123'), GIT_CONFIG_NOSYSTEM: '1', HOME: '/nonexistent' };
  const url = execFileSync('git', ['ls-remote', '--get-url', 'https://gitlab.com/x/y'], { env }).toString().trim();
  assert.equal(url, 'https://gitlab.com/x/y');
});
