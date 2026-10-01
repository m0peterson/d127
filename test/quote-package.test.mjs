// Имитация пакета функции: копия кода во временной папке, куда файл сборника можно положить или не положить.
// У каждой копии свой набор модулей, а значит и свой кэш сборника, так что тесты не влияют друг на друга и на quote.test.mjs.

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseQuotes } from '../public/js/quotes.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COLLECTION_FILE = 'public/data/quotes.txt';
const CODE = [
  'netlify/functions/quote.mjs',
  'netlify/lib/llm.mjs',
  'netlify/lib/collection.mjs',
  'public/js/dice.js',
  'public/js/quotes.js',
];
const QUOTES = parseQuotes(readFileSync(path.join(ROOT, COLLECTION_FILE), 'utf8'));

let dirs;
let realFetch;
let realCwd;
let fetched; // всё, за чем функция полезла в сеть
let siteReply;

beforeEach(() => {
  // Функция ищет файл ещё и в текущей папке. Тесты запускаются из корня репозитория, где он есть, поэтому уходим оттуда:
  // в Lambda текущая папка это корень пакета, и «пакета без сборника» иначе не изобразить
  realCwd = process.cwd();
  process.chdir(tmpdir());
  dirs = [];
  fetched = [];
  siteReply = () => new Response('нужен вход', { status: 401 }); // закрытое превью: сайт не отвечает функции
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return siteReply();
  };
  globalThis.Netlify = { env: { get: (name) => ({ LLM_PROVIDER: 'mock' })[name] } };
  mock.method(console, 'error', () => {});
});

afterEach(async () => {
  process.chdir(realCwd);
  globalThis.fetch = realFetch;
  mock.restoreAll();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Копия кода во временной папке. withCollection кладёт рядом файл сборника, как это делает included_files. */
async function makePackage({ withCollection }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'd127-pkg-'));
  dirs.push(dir);
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  const files = withCollection ? [...CODE, COLLECTION_FILE] : CODE;
  for (const rel of files) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await copyFile(path.join(ROOT, rel), path.join(dir, rel));
  }
  const { default: handler } = await import(pathToFileURL(path.join(dir, 'netlify/functions/quote.mjs')).href);
  return (body) =>
    handler(
      new Request('https://deploy-preview-7--site.test/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
}

const logged = () => console.error.mock.calls.map((c) => c.arguments.join(' ')).join('\n');

test('сборник лежит в пакете: закрытый сайт не мешает и в сеть за сборником не ходят', async () => {
  const call = await makePackage({ withCollection: true });
  const res = await call({ d127: 46, d3: 1 });
  assert.equal(res.status, 200);
  assert.ok(QUOTES.includes((await res.json()).text), 'ответ не из сборника');
  assert.deepEqual(fetched, [], 'функция полезла в сеть за сборником');
});

test('сборника в пакете нет и сайт закрыт: 503 со своим кодом, в логе обе причины', async () => {
  const call = await makePackage({ withCollection: false });
  const res = await call({ d127: 46, d3: 1 });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'Сборник недоступен на сервере', code: 'collection_unavailable' });
  assert.deepEqual(fetched, ['https://deploy-preview-7--site.test/data/quotes.txt']);
  assert.match(logged(), /в пакете функции: .*файла нет/);
  assert.match(logged(), /Через сайт: .*HTTP 401/);
});

test('сборника в пакете нет, но сайт открыт: запасной путь через сеть работает', async () => {
  siteReply = () => new Response(readFileSync(path.join(ROOT, COLLECTION_FILE), 'utf8'));
  const call = await makePackage({ withCollection: false });
  const res = await call({ d127: 46, d3: 1 });
  assert.equal(res.status, 200);
  assert.ok(QUOTES.includes((await res.json()).text));
  assert.equal(fetched.length, 1);
});

test('netlify.toml кладёт сборник в пакет функции (иначе остаётся хрупкий запрос к своему сайту)', () => {
  const toml = readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /\[functions\][^[]*included_files\s*=\s*\[[^\]]*"public\/data\/quotes\.txt"/);
});
