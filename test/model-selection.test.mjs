import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/quote.mjs';
import { DEFAULT_MODEL, MODEL_OPTIONS } from '../public/js/models.js';

const SITE_KEY = 'sk-or-site-secret';
const OWN_KEY = 'sk-or-personal-secret';
let env, requests, answer;
const realFetch = globalThis.fetch;

beforeEach(() => {
  env = { LLM_PROVIDER: 'openrouter', LLM_API_KEY: SITE_KEY, LLM_MODEL: 'old/model' };
  globalThis.Netlify = { env: { get: (name) => env[name] } };
  requests = [];
  answer = () => Response.json({ choices: [{ message: { content: 'Новая цитата' } }] });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/models')) {
      assert.ok(!init?.headers?.Authorization, 'публичный каталог не должен получать ключ');
      return Response.json({ data: MODEL_OPTIONS.map(({ id }) => ({
        id, supported_parameters: ['reasoning'], reasoning: { supported_efforts: ['xhigh', 'high'] },
      })) });
    }
    requests.push({ headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    return answer(requests.length, requests.at(-1));
  };
  mock.method(console, 'error', () => {});
});

afterEach(() => { globalThis.fetch = realFetch; mock.restoreAll(); });

const call = (extra = {}) => handler(new Request('https://site.test/api/quote', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ d127: 5, d3: 2, ...extra }),
}));

test('без LLM_MODEL используется Muse с high, первый успех останавливает цепочку', async () => {
  delete env.LLM_MODEL;
  const res = await call();
  assert.equal(res.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.model, DEFAULT_MODEL);
  assert.deepEqual(requests[0].body.reasoning, { effort: 'high', exclude: true });
});

test('ошибка Muse и пустой MiMo запускают Haiku с xhigh', async () => {
  answer = (attempt) => attempt === 1
    ? Response.json({ error: { message: 'Model unavailable' } }, { status: 503 })
    : attempt === 2 ? Response.json({ choices: [{ message: { content: '<think>только мысли</think>' } }] })
      : Response.json({ choices: [{ message: { content: '«Резерв сработал»' } }] });
  const res = await call();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: 'Резерв сработал' });
  assert.deepEqual(requests.map(r => r.body.model), MODEL_OPTIONS.map(m => m.id));
  assert.deepEqual(requests.map(r => r.body.reasoning.effort), ['high', 'high', 'xhigh']);
  assert.ok(requests.every(r => r.body.max_tokens >= 8192 && r.signal instanceof AbortSignal));
});

test('выбранный MiMo получает резерв Haiku, выбранный Haiku не запускает предыдущие модели', async () => {
  answer = () => Response.json({ error: { message: 'No endpoint' } }, { status: 404 });
  assert.equal((await call({ model: MODEL_OPTIONS[1].id })).status, 502);
  assert.deepEqual(requests.map(r => r.body.model), MODEL_OPTIONS.slice(1).map(m => m.id));
  requests = [];
  assert.equal((await call({ model: MODEL_OPTIONS[2].id })).status, 502);
  assert.deepEqual(requests.map(r => r.body.model), [MODEL_OPTIONS[2].id]);
});

test('свой ключ выбирает OpenRouter даже при mock и отсутствии серверных настроек', async () => {
  env = { LLM_PROVIDER: 'mock' };
  assert.equal((await call({ apiKey: `  ${OWN_KEY}  ` })).status, 200);
  assert.equal(requests[0].headers.Authorization, `Bearer ${OWN_KEY}`);
});

test('пустой ключ использует ключ сайта; выбор модели из UI использует OpenRouter', async () => {
  env.LLM_PROVIDER = 'opencodego';
  assert.equal((await call({ apiKey: '   ', model: MODEL_OPTIONS[1].id })).status, 200);
  assert.equal(requests[0].headers.Authorization, `Bearer ${SITE_KEY}`);
  assert.equal(requests[0].body.model, MODEL_OPTIONS[1].id);
});

test('ошибки ключа и кредита останавливают цепочку, личный ключ не заменяется ключом сайта', async () => {
  for (const status of [401, 402]) {
    requests = [];
    answer = () => Response.json({ error: { message: 'Credential error' } }, { status });
    assert.equal((await call({ apiKey: OWN_KEY })).status, 502);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.Authorization, `Bearer ${OWN_KEY}`);
  }
});

test('ограничение конкретного провайдера 403 запускает резерв с тем же ключом', async () => {
  answer = (attempt) => attempt === 1
    ? Response.json({ error: { message: 'Provider restriction' } }, { status: 403 })
    : Response.json({ choices: [{ message: { content: 'Другая модель ответила' } }] });
  assert.equal((await call({ apiKey: OWN_KEY })).status, 200);
  assert.deepEqual(requests.map(r => r.body.model), MODEL_OPTIONS.slice(0, 2).map(m => m.id));
  assert.ok(requests.every(r => r.headers.Authorization === `Bearer ${OWN_KEY}`));
});

test('неподдерживаемый reasoning повторяется без него на той же модели', async () => {
  answer = (attempt) => attempt === 1
    ? Response.json({ error: { message: 'reasoning is not supported' } }, { status: 400 })
    : Response.json({ choices: [{ message: { content: 'Без reasoning' } }] });
  assert.equal((await call()).status, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.model, requests[1].body.model);
  assert.ok(requests[0].body.reasoning);
  assert.ok(!('reasoning' in requests[1].body));
});

test('при отказе в xhigh Haiku повторяется с high, а при отказе в reasoning — без него', async () => {
  answer = (attempt) => attempt < 3
    ? Response.json({ error: { message: 'Unsupported reasoning effort' } }, { status: 422 })
    : Response.json({ choices: [{ message: { content: 'Третий запрос' } }] });
  assert.equal((await call({ model: MODEL_OPTIONS[2].id })).status, 200);
  assert.deepEqual(requests.map(r => r.body.reasoning?.effort), ['xhigh', 'high', undefined]);
  assert.ok(requests.every(r => r.body.model === MODEL_OPTIONS[2].id));
});

test('ошибка в JSON с HTTP 200 тоже запускает резерв; обычный HTTP 400 не повторяет reasoning', async () => {
  answer = (attempt) => attempt === 1
    ? Response.json({ error: { code: 503, message: 'Provider failed' } })
    : attempt === 2 ? Response.json({ error: { message: 'Model unavailable' } }, { status: 400 })
      : Response.json({ choices: [{ message: { content: 'Резерв' } }] });
  assert.equal((await call()).status, 200);
  assert.deepEqual(requests.map(r => r.body.model), MODEL_OPTIONS.map(m => m.id));
});

test('после отказа всех моделей нейтральный 502; оба ключа скрыты в ответе и логе', async () => {
  answer = () => Response.json({ error: { message: `Invalid ${OWN_KEY}, site ${SITE_KEY}` } }, { status: 503 });
  const res = await call({ apiKey: OWN_KEY });
  assert.equal(res.status, 502);
  assert.equal(requests.length, 3);
  const response = await res.text();
  const logs = console.error.mock.calls.flatMap(c => c.arguments).join(' ');
  for (const secret of [SITE_KEY, OWN_KEY]) {
    assert.ok(!response.includes(secret));
    assert.ok(!logs.includes(secret));
  }
  assert.equal(JSON.parse(response).code, 'model_failed');
});

test('неизвестные модели и некорректные ключи отклоняются до запроса к провайдеру', async () => {
  for (const model of ['vendor/arbitrary-model', '', null, 42, ['x'], { id: DEFAULT_MODEL }]) {
    const res = await call({ model });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'invalid_model');
  }
  for (const apiKey of [null, 42, [], {}, 'x'.repeat(2049), 'sk-key\nheader', 'ключ']) {
    const res = await call({ apiKey });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'invalid_key');
  }
  assert.equal(requests.length, 0);
});

test('mock с выбранной моделью работает без ключа и не вызывает каталог или провайдера', async () => {
  env = { LLM_PROVIDER: 'mock' };
  globalThis.fetch = () => { assert.fail('mock должен работать без сети'); };
  const res = await call({ model: DEFAULT_MODEL });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).text);
});

test('таймаут и сетевой сбой запускают следующие модели', async () => {
  answer = (attempt) => {
    if (attempt === 1) throw new DOMException('timed out', 'TimeoutError');
    if (attempt === 2) throw new TypeError('network unavailable');
    return Response.json({ choices: [{ message: { content: 'Резерв после таймаута' } }] });
  };
  assert.equal((await call()).status, 200);
  assert.deepEqual(requests.map(r => r.body.model), MODEL_OPTIONS.map(m => m.id));
});

test('ключи скрываются перед обрезанием длинной ошибки провайдера или ответа без JSON', async () => {
  const longKey = `sk-or-personal-${'secret'.repeat(50)}`;
  for (const nonJson of [false, true]) {
    answer = () => nonJson
      ? new Response(`Invalid ${longKey} site ${SITE_KEY}`, { status: 502 })
      : Response.json({ error: { message: `${'x'.repeat(180)} ${longKey} ${SITE_KEY}` } }, { status: 401 });
    const res = await call({ apiKey: longKey });
    assert.equal(res.status, 502);
    const logs = console.error.mock.calls.flatMap(c => c.arguments).join(' ');
    assert.ok(!logs.includes('sk-or-'), 'в логе осталась часть ключа');
  }
});

test('три медленные модели укладываются в общий бюджет без полного таймаута на каждый запрос', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const start = Date.now();
  const timeouts = [];
  mock.method(AbortSignal, 'timeout', (ms) => {
    timeouts.push(ms);
    return new AbortController().signal;
  });
  answer = () => {
    mock.timers.tick(timeouts.at(-1));
    throw new DOMException('timed out', 'TimeoutError');
  };
  assert.equal((await call()).status, 502);
  assert.equal(requests.length, 3);
  assert.ok(timeouts.filter(ms => ms > 1000).every(ms => ms <= 8334));
  assert.ok(Date.now() - start <= 25000);
});

test('выбранный отдельно Haiku получает оставшийся общий бюджет на xhigh', async () => {
  const timeouts = [];
  mock.method(AbortSignal, 'timeout', (ms) => {
    timeouts.push(ms);
    return new AbortController().signal;
  });
  assert.equal((await call({ model: MODEL_OPTIONS[2].id })).status, 200);
  assert.equal(requests.length, 1);
  assert.ok(timeouts.at(-1) > 20000 && timeouts.at(-1) <= 25000);
});
