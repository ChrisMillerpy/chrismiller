import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelList, resolve, turnSettings, validate } from './models.ts';

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

test('effort and summarised thinking are sent to Anthropic', () => {
  assert.deepEqual(turnSettings('m', 'high').streamOptions, { providerOptions: { anthropic: { effort: 'high', thinking: { type: 'adaptive', display: 'summarized' } } } });
});
