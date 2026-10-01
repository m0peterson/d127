import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, loadSettings, purgeLegacySettings, saveSettings } from '../public/js/settings.js';

const KEY = 'd127.settings.v1';
let store;

beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
});

test('по умолчанию режим LLM и пустые свои примеры', () => {
  assert.equal(DEFAULT_SETTINGS.source, 'llm');
  assert.deepEqual(loadSettings(), { source: 'llm', examples: '' });
});

test('сохранённый выбор сборника и примеры читаются обратно', () => {
  assert.ok(saveSettings({ source: 'collection' }));
  assert.ok(saveSettings({ examples: 'раз\nдва' }));
  assert.deepEqual(loadSettings(), { source: 'collection', examples: 'раз\nдва' });
});

test('мусор в хранилище не ломает загрузку', () => {
  store.set(KEY, JSON.stringify({ source: 'gpt', examples: 42 }));
  assert.deepEqual(loadSettings(), { source: 'llm', examples: '' });
  store.set(KEY, 'не json');
  assert.deepEqual(loadSettings(), { source: 'llm', examples: '' });
});

test('старые ключи и модели стираются, примеры и выбор источника остаются', () => {
  store.set(KEY, JSON.stringify({ source: 'collection', examples: 'моя цитата', openrouterKey: 'sk-secret', provider: 'openrouter' }));
  purgeLegacySettings();
  assert.deepEqual(JSON.parse(store.get(KEY)), { source: 'collection', examples: 'моя цитата' });
  assert.ok(!store.get(KEY).includes('sk-secret'));
});
