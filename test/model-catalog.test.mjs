import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createModelCatalogLoader, getReasoningConfig } from '../netlify/lib/model-catalog.mjs';

test('catalog GET is anonymous, validates entries and caches successful responses for five minutes', async () => {
  let time = 1000;
  let calls = 0;
  const model = { id: 'vendor/model', supported_parameters: ['reasoning'] };
  const load = createModelCatalogLoader({
    now: () => time,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, 'https://openrouter.ai/api/v1/models');
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'omit');
      assert.deepEqual(init.headers, { Accept: 'application/json' });
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json({ data: [null, {}, { id: 5 }, { id: '' }, model] });
    },
  });
  const first = await load();
  assert.equal(first.size, 1);
  assert.deepEqual(first.get(model.id), model);
  time += 299_999;
  assert.equal(await load(), first);
  assert.equal(calls, 1);
  time++;
  assert.notEqual(await load(), first);
  assert.equal(calls, 2);
});

test('concurrent catalog requests share one in-flight promise and cache time starts on completion', async () => {
  let time = 0;
  let calls = 0;
  let reply;
  const pending = new Promise((resolve) => { reply = resolve; });
  const load = createModelCatalogLoader({ now: () => time, fetchImpl: () => { calls++; return pending; } });
  const first = load();
  assert.equal(load(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  time = 5000;
  reply(Response.json({ data: [{ id: 'vendor/model' }] }));
  const catalog = await first;
  time = 304_999;
  assert.equal(await load(), catalog);
  assert.equal(calls, 1);
});

test('network errors return an empty catalog and recover after a thirty-second failure cache', async () => {
  let time = 0;
  let calls = 0;
  const load = createModelCatalogLoader({
    now: () => time,
    fetchImpl: () => {
      calls++;
      if (calls === 1) throw new TypeError('Network unavailable');
      return Promise.resolve(Response.json({ data: [{ id: 'recovered/model' }] }));
    },
  });
  const failure = await load();
  assert.ok(failure instanceof Map);
  assert.equal(failure.size, 0);
  time = 29_999;
  assert.equal(await load(), failure);
  assert.equal(calls, 1);
  time = 30_000;
  assert.ok((await load()).has('recovered/model'));
  assert.equal(calls, 2);
});

test('HTTP errors and malformed catalog responses fail gracefully and can be retried', async () => {
  for (const response of [
    () => new Response('Unavailable', { status: 503 }),
    () => new Response('not JSON'),
    () => Response.json(null),
    () => Response.json({ data: {} }),
    () => Response.json({ data: [{ id: 7 }, null] }),
  ]) {
    let time = 0;
    let calls = 0;
    const load = createModelCatalogLoader({ now: () => time, fetchImpl: async () => { calls++; return response(); } });
    assert.equal((await load()).size, 0);
    time = 30_000;
    assert.equal((await load()).size, 0);
    assert.equal(calls, 2);
  }
});

test('empty valid catalog is cached as a successful lookup', async () => {
  let time = 0;
  let calls = 0;
  const load = createModelCatalogLoader({ now: () => time, fetchImpl: async () => { calls++; return Response.json({ data: [] }); } });
  assert.equal((await load()).size, 0);
  time = 30_000;
  assert.equal((await load()).size, 0);
  assert.equal(calls, 1);
});

test('requested high and xhigh efforts are retained when supported, with reasoning excluded from output', () => {
  const model = { supported_parameters: ['reasoning'], reasoning: { supported_efforts: ['xhigh', 'high', 'medium', 'none'] } };
  assert.deepEqual(getReasoningConfig(model, 'high'), { effort: 'high', exclude: true });
  assert.deepEqual(getReasoningConfig(model, 'xhigh'), { effort: 'xhigh', exclude: true });
});

test('unsupported requested effort selects the highest allowed effort in metadata order', () => {
  assert.deepEqual(getReasoningConfig({ reasoning: { supported_efforts: ['high', 'medium'] } }, 'xhigh'), { effort: 'high', exclude: true });
  assert.deepEqual(getReasoningConfig({ reasoning: { supported_efforts: ['max', 'xhigh', 'medium'] } }, 'high'), { effort: 'max', exclude: true });
  assert.deepEqual(getReasoningConfig({ reasoning: { supported_efforts: [null, 'none', 'minimal', 'low'] } }, 'high'), { effort: 'low', exclude: true });
});

test('models known not to support reasoning or meaningful effort omit the config', () => {
  assert.equal(getReasoningConfig({ supported_parameters: ['temperature'] }, 'high'), undefined);
  assert.equal(getReasoningConfig({ supported_parameters: [] }, 'xhigh'), undefined);
  for (const supported_efforts of [[], ['none'], ['none', 'minimal']]) {
    assert.equal(getReasoningConfig({ supported_parameters: ['reasoning'], reasoning: { supported_efforts } }, 'high'), undefined);
  }
});

test('reasoning metadata establishes support even when supported_parameters omits it', () => {
  const model = { supported_parameters: ['temperature'], reasoning: { mandatory: true, supported_efforts: ['high'] } };
  assert.deepEqual(getReasoningConfig(model, 'high'), { effort: 'high', exclude: true });
});

test('unknown models and unrestricted effort metadata preserve the requested effort', () => {
  for (const model of [undefined, null, {}, { reasoning: { supported_efforts: null } }, { supported_parameters: ['reasoning'] }]) {
    assert.deepEqual(getReasoningConfig(model, 'xhigh'), { effort: 'xhigh', exclude: true });
  }
});
