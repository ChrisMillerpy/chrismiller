import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelList, providerFor, resolve, turnSettings, validate } from './models.ts';

const env = { MODEL: 'claude-opus-5-5', MODELS: 'claude-opus-5-5=Opus 5.5, claude-sonnet-5-5=Sonnet 5.5,claude-haiku-5-5' };

test('the model list comes from MODELS, with labels', () => {
  assert.deepEqual(modelList(env), [
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5' },
  ]);
  assert.deepEqual(modelList({ MODEL: 'm' }), [{ id: 'm', label: 'm' }], 'the default is always offered');
});

test('only listed models and known efforts are accepted', () => {
  assert.deepEqual(validate(env, { model: 'claude-sonnet-5-5', effort: 'high' }), { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.throws(() => validate(env, { model: 'gpt-9' }), /Unknown model/);
  assert.throws(() => validate(env, { effort: 'extreme' }), /Effort/);
});

test('saved choices fall back to defaults, including when a model is removed', () => {
  assert.deepEqual(resolve(env, {}), { model: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(resolve(env, { model: 'claude-old', effort: 'low' }), { model: 'claude-opus-5-5', effort: 'low' });
});

test('effort, summarised thinking and a 1-hour prompt cache are sent to Anthropic', () => {
  assert.deepEqual(turnSettings('m', 'high').streamOptions, {
    providerOptions: { anthropic: { effort: 'high', thinking: { type: 'adaptive', display: 'summarized' }, cacheControl: { type: 'ephemeral', ttl: '1h' } } },
  });
});

test('the provider comes from the model id', () => {
  for (const id of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.5', 'o4-mini', 'openai/gpt-6-sol']) assert.equal(providerFor(id), 'openai', id);
  for (const id of ['claude-opus-5-5', 'claude-haiku-5-5', 'something-else']) assert.equal(providerFor(id), 'anthropic', id);
});

test('GPT models get reasoning effort and summaries, and nothing is stored at OpenAI', () => {
  assert.deepEqual(turnSettings('gpt-6.1-sol', 'high').streamOptions, { providerOptions: { openai: { reasoningEffort: 'high', reasoningSummary: 'auto', store: false } } });
  for (const e of ['low', 'medium', 'high', 'max'] as const) {
    assert.equal((turnSettings('gpt-6-astra', e).streamOptions as any).providerOptions.openai.reasoningEffort, e);
  }
  assert.equal((turnSettings('gpt-6-astra', 'low').streamOptions as any).providerOptions.anthropic, undefined, 'no Anthropic options for GPT');
  assert.equal((turnSettings('claude-opus-5-5', 'low').streamOptions as any).providerOptions.openai, undefined, 'no OpenAI options for Claude');
});
