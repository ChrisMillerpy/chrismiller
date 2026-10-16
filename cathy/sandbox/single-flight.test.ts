import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from './single-flight.ts';

test('concurrent calls share one run', async () => {
  let runs = 0;
  const prepare = singleFlight(async () => {
    runs++;
    await new Promise((r) => setTimeout(r, 20));
    return 'ready';
  });
  const results = await Promise.all([prepare(), prepare(), prepare()]);
  assert.equal(runs, 1);
  assert.deepEqual(results, ['ready', 'ready', 'ready']);
});

test('a later call after it finishes runs again', async () => {
  let runs = 0;
  const prepare = singleFlight(async () => {
    runs++;
  });
  await prepare();
  await prepare();
  assert.equal(runs, 2);
});

test('a failure reaches every waiter and does not stick', async () => {
  let runs = 0;
  const prepare = singleFlight(async () => {
    runs++;
    if (runs === 1) throw new Error('lock busy');
  });
  const all = await Promise.allSettled([prepare(), prepare()]);
  assert.deepEqual(all.map((r) => r.status), ['rejected', 'rejected']);
  await prepare(); // second attempt runs fresh and succeeds
  assert.equal(runs, 2);
});
