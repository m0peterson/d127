import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, loadSettings, purgeLegacySettings, saveSettings } from '../public/js/settings.js';
import { DEFAULT_MODEL, MODEL_OPTIONS } from '../public/js/models.js';

const KEY = 'd127.settings.v1';
let store;

beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
});

test('по умолчанию режим LLM, Muse и пустой личный ключ', () => {
  assert.equal(DEFAULT_SETTINGS.source, 'llm');
  assert.equal(DEFAULT_MODEL, 'meta/muse-spark-1.3-contributor');
  assert.deepEqual(loadSettings(), { source: 'llm', examples: '', model: DEFAULT_MODEL, apiKey: '' });
});

test('сохранённый выбор сборника и примеры читаются обратно', () => {
  assert.ok(saveSettings({ source: 'collection' }));
  assert.ok(saveSettings({ examples: 'раз\nдва' }));
  assert.deepEqual(loadSettings(), { source: 'collection', examples: 'раз\nдва', model: DEFAULT_MODEL, apiKey: '' });
});

test('мусор в хранилище не ломает загрузку', () => {
  for (const stored of [
    { source: 'gpt', examples: 42, model: 'old/provider-model', apiKey: 123 },
    { source: {}, examples: [], model: {}, apiKey: { key: 'secret' } },
    null, [], 'строка',
  ]) {
    store.set(KEY, JSON.stringify(stored));
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  }
  store.set(KEY, 'не json');
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('старые поля стираются без переноса ключа, поддерживаемые настройки остаются', () => {
  store.set(KEY, JSON.stringify({
    source: 'collection', examples: 'моя цитата', openrouterKey: 'sk-old-secret', provider: 'openrouter',
    model: MODEL_OPTIONS[1].id, apiKey: ' sk-current-key ',
  }));
  purgeLegacySettings();
  assert.deepEqual(JSON.parse(store.get(KEY)), {
    source: 'collection', examples: 'моя цитата', model: MODEL_OPTIONS[1].id, apiKey: 'sk-current-key',
  });
  assert.ok(!store.get(KEY).includes('sk-old-secret'));
});

test('настройки предыдущей версии получают модель по умолчанию и пустой ключ', () => {
  store.set(KEY, JSON.stringify({ source: 'llm', examples: 'пример', openrouterKey: 'sk-old-secret', model: 'google/old' }));
  purgeLegacySettings();
  assert.deepEqual(JSON.parse(store.get(KEY)), { source: 'llm', examples: 'пример', model: DEFAULT_MODEL, apiKey: '' });
});

test('личный ключ и модель сохраняются, очистка ключа возвращает пустое поле', () => {
  assert.ok(saveSettings({ model: MODEL_OPTIONS[2].id, apiKey: '  sk-personal-key\n' }));
  assert.deepEqual(loadSettings(), { source: 'llm', examples: '', model: MODEL_OPTIONS[2].id, apiKey: 'sk-personal-key' });
  assert.ok(saveSettings({ apiKey: '  ' }));
  assert.equal(loadSettings().apiKey, '');
  assert.equal(loadSettings().model, MODEL_OPTIONS[2].id);
  assert.ok(!store.get(KEY).includes('sk-personal-key'));
});

test('сохранение не добавляет неизвестные поля и не допускает некорректные типы', () => {
  assert.ok(saveSettings({ model: 'constructor', apiKey: ['sk-key'], provider: 'custom', source: 'bad', examples: false }));
  assert.deepEqual(JSON.parse(store.get(KEY)), DEFAULT_SETTINGS);
});

test('недоступное хранилище возвращает настройки по умолчанию и false при записи', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('storage blocked'); },
    setItem: () => { throw new Error('storage blocked'); },
  };
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  assert.equal(saveSettings({ apiKey: 'sk-personal-key' }), false);
});
