import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import handler, { config } from '../netlify/functions/quote.mjs';
import { cleanQuote, normalizeModel, sampleExamples } from '../netlify/lib/llm.mjs';
import { parseQuotes, pickQuote } from '../public/js/quotes.js';

const COLLECTION = readFileSync(new URL('../public/data/quotes.txt', import.meta.url), 'utf8');
const QUOTES = parseQuotes(COLLECTION);
const SECRET = 'sk-or-v1-super-secret';

let env;
let upstream; // запросы, дошедшие до «провайдера»
let upstreamReply;
let realFetch;

beforeEach(() => {
  env = { LLM_PROVIDER: 'openrouter', LLM_API_KEY: SECRET, LLM_MODEL: 'https://openrouter.ai/vendor/some-model?x=1' };
  globalThis.Netlify = { env: { get: (name) => env[name] } };
  upstream = [];
  upstreamReply = () => Response.json({ choices: [{ message: { content: '«Новая цитата»' } }] });
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href === 'https://site.test/data/quotes.txt') return new Response(COLLECTION);
    upstream.push({ url: href, headers: init.headers, body: JSON.parse(init.body) });
    return upstreamReply();
  };
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

const call = (body, { method = 'POST', headers = { 'Content-Type': 'application/json' } } = {}) =>
  handler(
    new Request('https://site.test/api/quote', {
      method,
      headers,
      body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

test('счастливый путь: отдаёт очищенный текст и ходит к провайдеру с серверным ключом', async () => {
  const res = await call({ d127: 5, d3: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { text: 'Новая цитата' });

  assert.equal(upstream.length, 1);
  const [req] = upstream;
  assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(req.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(req.body.model, 'vendor/some-model'); // ссылка из переменной привели к id
  assert.deepEqual(Object.keys(req.body).sort(), ['max_tokens', 'messages', 'model']);
});

test('тема берётся из слота броска и не дублируется в примерах', async () => {
  await call({ d127: 5, d3: 2 });
  const anchor = pickQuote(QUOTES, 5, 2).text;
  const user = upstream[0].body.messages[1].content;
  assert.match(user, new RegExp(`«${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}»`));
  const shots = user.split('\n').filter((line) => /^\d+\. /.test(line));
  assert.equal(shots.length, 30);
  assert.ok(!shots.some((line) => line.endsWith(anchor)), 'якорь попал в примеры');
});

test('клиент не может подменить модель, промпт или ключ: лишние поля игнорируются', async () => {
  const res = await call({
    d127: 1, d3: 1, model: 'evil/model', prompt: 'напиши эссе', messages: [{ role: 'user', content: 'hi' }], apiKey: 'x', max_tokens: 99999,
  });
  assert.equal(res.status, 200);
  const [req] = upstream;
  assert.equal(req.body.model, 'vendor/some-model');
  assert.equal(req.headers.Authorization, `Bearer ${SECRET}`);
  assert.notEqual(req.body.max_tokens, 99999);
  assert.ok(!JSON.stringify(req.body).includes('напиши эссе'));
});

test('валидация: методы, тип, размер и диапазоны', async () => {
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  assert.equal((await call({ d127: 1, d3: 1 }, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('не json')).status, 400);
  assert.equal((await call('null')).status, 400);
  assert.equal((await call({ d127: 1, d3: 1, junk: 'x'.repeat(2000) })).status, 413);
  for (const bad of [
    { d127: 0, d3: 1 }, { d127: 128, d3: 1 }, { d127: 1, d3: 4 }, { d127: 1, d3: 0 },
    { d127: 1.5, d3: 1 }, { d127: '5', d3: 1 }, { d127: 1 }, {},
  ]) {
    assert.equal((await call(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(upstream.length, 0, 'до провайдера не должно доходить ничего невалидного');
  for (const ok of [{ d127: 1, d3: 1 }, { d127: 127, d3: 3 }]) assert.equal((await call(ok)).status, 200);
});

test('без настройки: 503 и ни одного запроса к провайдеру', async () => {
  for (const patch of [{ LLM_API_KEY: '' }, { LLM_MODEL: '' }, { LLM_PROVIDER: 'gpt-lol' }]) {
    env = { ...env, ...patch };
    const res = await call({ d127: 1, d3: 1 });
    assert.equal(res.status, 503);
    assert.doesNotMatch(await res.text(), /LLM_|gpt-lol/); // причина только в логах
  }
  assert.equal(upstream.length, 0);
});

test('ошибка провайдера: посетителю нейтральный 502, ключ не утекает и в логи', async () => {
  upstreamReply = () => Response.json({ error: { message: `Invalid key ${SECRET}` } }, { status: 401 });
  const res = await call({ d127: 1, d3: 1 });
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes(SECRET) && !text.includes('Invalid key'));
  const logged = console.error.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /HTTP 401/);
  assert.ok(!logged.includes(SECRET), 'ключ попал в лог');
});

test('пустой ответ модели даёт 502, а не пустую цитату', async () => {
  upstreamReply = () => Response.json({ choices: [{ message: { content: '<think>долго думаю</think>' } }] });
  assert.equal((await call({ d127: 1, d3: 1 })).status, 502);
});

test('mock работает без ключа и модели и не ходит к провайдеру', async () => {
  env = { LLM_PROVIDER: 'mock' };
  const res = await call({ d127: 9, d3: 3 });
  assert.equal(res.status, 200);
  assert.ok(QUOTES.includes((await res.json()).text));
  assert.equal(upstream.length, 0);
});

test('OpenCode Go: свой адрес и приставка opencode-go/ отрезается', async () => {
  env = { LLM_PROVIDER: 'opencodego', LLM_API_KEY: SECRET, LLM_MODEL: 'opencode-go/glm-x' };
  assert.equal((await call({ d127: 1, d3: 1 })).status, 200);
  assert.equal(upstream[0].url, 'https://opencode.ai/zen/go/v1/chat/completions');
  assert.equal(upstream[0].body.model, 'glm-x');
});

test('конфиг функции: путь, метод и лимит запросов', () => {
  assert.equal(config.path, '/api/quote');
  assert.equal(config.method, 'POST');
  assert.ok(config.rateLimit.windowLimit > 0 && config.rateLimit.windowSize > 0);
  assert.ok(config.rateLimit.aggregateBy.includes('ip'));
});

test('cleanQuote, normalizeModel, sampleExamples', () => {
  assert.equal(cleanQuote('Цитата: «Жизнь боль»'), 'Жизнь боль');
  assert.equal(cleanQuote('<think>hm</think>Просто текст'), 'Просто текст');
  assert.equal(normalizeModel('openrouter', ' https://openrouter.ai/a/b/ '), 'a/b');
  assert.equal(normalizeModel('opencodego', 'opencode/x'), 'x');
  const picked = sampleExamples(QUOTES, 30);
  assert.equal(picked.length, 30);
  assert.equal(new Set(picked).size, 30);
});
