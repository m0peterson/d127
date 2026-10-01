import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateQuote } from '../public/js/llm.js';

const realFetch = globalThis.fetch;
let sent; // что клиент отправил на сервер

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Подменяет fetch ответом сервера. Тело строкой уходит как есть (HTML), объектом как JSON. */
function serverAnswers(status, body, headers) {
  sent = null;
  globalThis.fetch = async (url, init) => {
    sent = { url, init };
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
}

/** Текст, который клиент покажет в тосте. */
async function reasonShown() {
  try {
    await generateQuote({ d127: 5, d3: 2 });
  } catch (err) {
    return err.message;
  }
  assert.fail('ожидалась ошибка');
}

test('успех: текст обрезается по краям, на сервер уходят только два числа', async () => {
  serverAnswers(200, { text: '  Новая цитата \n' });
  assert.equal(await generateQuote({ d127: 5, d3: 2 }), 'Новая цитата');
  assert.equal(sent.url, '/api/quote');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body), { d127: 5, d3: 2 });
});

test('503 «не настроена» и 503 «сборник недоступен» различаются', async () => {
  serverAnswers(503, { error: 'Генерация не настроена на сервере', code: 'not_configured' });
  assert.equal(await reasonShown(), 'генерация не настроена на сервере');

  serverAnswers(503, { error: 'Сборник недоступен на сервере', code: 'collection_unavailable' });
  const reason = await reasonShown();
  assert.match(reason, /сборник/);
  assert.doesNotMatch(reason, /не настроена/);
});

test('служебные слова в code не превращаются в подсказку из прототипа', async () => {
  serverAnswers(503, { error: 'x', code: 'constructor' });
  assert.equal(await reasonShown(), 'сервер сейчас недоступен');
});

test('503 без нашего JSON (ответила платформа) не выдаётся за «не настроена»', async () => {
  serverAnswers(503, '<html>Site not available</html>', { 'content-type': 'text/html' });
  const reason = await reasonShown();
  assert.equal(reason, 'сервер сейчас недоступен');
  assert.doesNotMatch(reason, /не настроена/);
});

test('ответы платформы без JSON объясняются по статусу', async () => {
  serverAnswers(404, '<html>Not found</html>');
  assert.match(await reasonShown(), /нет серверной функции/);

  serverAnswers(429, 'Too Many Requests');
  assert.match(await reasonShown(), /слишком много запросов/);

  serverAnswers(502, 'Bad gateway');
  assert.equal(await reasonShown(), 'модель не ответила');
});

test('502 от функции: модель не ответила', async () => {
  serverAnswers(502, { error: 'Модель не ответила', code: 'model_failed' });
  assert.equal(await reasonShown(), 'модель не ответила');
});

test('неизвестный код и статус: показываем текст ошибки из ответа или номер статуса', async () => {
  serverAnswers(400, { error: 'Нужны целые d127 от 1 до 127 и d3 от 1 до 3' });
  assert.match(await reasonShown(), /Нужны целые d127/);

  serverAnswers(500, 'oops');
  assert.equal(await reasonShown(), 'ошибка сервера (HTTP 500)');
});

test('нет связи и пустой ответ', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.equal(await reasonShown(), 'нет связи с сервером');

  serverAnswers(200, { text: '   ' });
  assert.equal(await reasonShown(), 'сервер вернул пустой ответ');
});
