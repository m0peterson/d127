import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCollectionLoader, localCandidates } from '../netlify/lib/collection.mjs';

const ORIGIN = 'https://site.test';
const FILE = 'public/data/quotes.txt';
const TEXT = '# комментарий\n\nпервая\nвторая\r\nтретья\n';
const QUOTES = ['первая', 'вторая', 'третья'];

/** Папка с файлом сборника внутри. Возвращает путь к файлу. */
async function withCollection(text, fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'd127-'));
  try {
    const file = path.join(root, FILE);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    return await fn(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const noNetwork = () => {
  throw new Error('в сеть ходить было нельзя');
};

/** fetch, который всегда отвечает одним и тем же и считает обращения. */
function site(makeResponse) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return makeResponse();
  };
  return { fetchImpl, calls };
}

test('файл из пакета читается без сети, комментарии и пустые строки отбрасываются', () =>
  withCollection(TEXT, async (file) => {
    const load = createCollectionLoader({ candidates: () => [file], fetchImpl: noNetwork });
    assert.deepEqual(await load(ORIGIN), QUOTES);
  }));

test('из списка путей берётся первый, где файл есть', () =>
  withCollection(TEXT, async (file) => {
    const load = createCollectionLoader({ candidates: () => ['/нет/такого/quotes.txt', file], fetchImpl: noNetwork });
    assert.deepEqual(await load(ORIGIN), QUOTES);
  }));

test('нет файла: сборник скачивается с сайта', async () => {
  const { fetchImpl, calls } = site(() => new Response(TEXT));
  const load = createCollectionLoader({ candidates: () => ['/нет/такого/quotes.txt'], fetchImpl });
  assert.deepEqual(await load(ORIGIN), QUOTES);
  assert.deepEqual(calls, ['https://site.test/data/quotes.txt']);
});

test('вместо сборника страница входа: и с кодом 200, и после редиректа на чужой адрес это ошибка', async () => {
  const html = '<!doctype html>\n<html><body>Войдите</body></html>';
  const login = site(() => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(
    createCollectionLoader({ candidates: () => [], fetchImpl: login.fetchImpl })(ORIGIN),
    /HTML-страница/,
  );

  const redirected = site(() => {
    const res = new Response(TEXT); // текст нормальный, но пришёл он не с нашего сайта
    Object.defineProperty(res, 'redirected', { value: true });
    Object.defineProperty(res, 'url', { value: 'https://app.netlify.com/login' });
    return res;
  });
  await assert.rejects(
    createCollectionLoader({ candidates: () => [], fetchImpl: redirected.fetchImpl })(ORIGIN),
    /app\.netlify\.com/,
  );
});

test('закрытый сайт (401) или упавшая сеть: в ошибке видны обе причины', async () => {
  const closed = site(() => new Response('нужен вход', { status: 401 }));
  await assert.rejects(
    createCollectionLoader({ candidates: () => ['/нет/quotes.txt'], fetchImpl: closed.fetchImpl })(ORIGIN),
    (err) => /в пакете функции: .*файла нет/.test(err.message) && /Через сайт: .*HTTP 401/.test(err.message),
  );
  await assert.rejects(
    createCollectionLoader({ candidates: () => [], fetchImpl: async () => { throw new TypeError('fetch failed'); } })(ORIGIN),
    /fetch failed/,
  );
});

test('пустой файл не считается сборником', () =>
  withCollection('# только комментарии\n\n', async (file) => {
    const { fetchImpl } = site(() => new Response('', { status: 404 }));
    await assert.rejects(createCollectionLoader({ candidates: () => [file], fetchImpl })(ORIGIN), /сборник пустой/);
  }));

test('успех кэшируется, неудача нет', () =>
  withCollection(TEXT, async (file) => {
    let present = false;
    const load = createCollectionLoader({
      candidates: () => (present ? [file] : ['/нет/quotes.txt']),
      fetchImpl: async () => new Response('', { status: 503 }),
    });
    await assert.rejects(load(ORIGIN));
    present = true;
    assert.deepEqual(await load(ORIGIN), QUOTES); // после неудачи пробует заново
    present = false;
    assert.deepEqual(await load(ORIGIN), QUOTES); // а удачу больше не перечитывает
  }));

test('пути поиска: корень репозитория, корень пакета Lambda и текущая папка, без повторов', () => {
  const moduleUrl = pathToFileURL(path.resolve('/var/task/netlify/functions/quote.mjs')).href;
  const at = (...roots) => roots.map((root) => path.join(path.resolve(root), FILE));

  // в пакете Netlify все три пути совпадают
  assert.deepEqual(localCandidates({ moduleUrl, taskRoot: '/var/task', cwd: '/var/task' }), at('/var/task'));
  // локально cwd может быть другим, корня Lambda нет
  assert.deepEqual(localCandidates({ moduleUrl, taskRoot: null, cwd: '/work' }), at('/var/task', '/work'));
});
