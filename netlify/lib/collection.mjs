/**
 * Сборник цитат для серверной функции.
 *
 *   loadCollection(origin) -> Promise<string[]>
 *
 * Основной путь: файл public/data/quotes.txt лежит прямо в пакете функции (netlify.toml, included_files), сеть не нужна.
 * Запасной путь: скачать его с самого сайта. Он хрупкий. Закрытые превью (пароль, вход в Netlify) не пускают на сайт
 * саму функцию, а вместо сборника приходит страница входа, поэтому ответ проверяется.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseQuotes } from '../../public/js/quotes.js';

const COLLECTION_FILE = 'public/data/quotes.txt';
const SITE_PATH = '/data/quotes.txt';
const SITE_TIMEOUT_MS = 5_000;

/**
 * Где может лежать файл: в корне репозитория (тесты, netlify dev; после сборки внутри пакета путь тот же),
 * в корне пакета Lambda и в текущей папке. Лишние совпадения отбрасываются.
 */
export function localCandidates({
  moduleUrl = import.meta.url,
  taskRoot = process.env.LAMBDA_TASK_ROOT,
  cwd = process.cwd(),
} = {}) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(moduleUrl)), '../..');
  return [...new Set([repoRoot, taskRoot, cwd].filter(Boolean).map((root) => path.join(root, COLLECTION_FILE)))];
}

// Страница входа, 404-страница с кодом 200 и прочий HTML не должны сойти за цитаты
const looksLikeHtml = (text) => /^\s*<(?:!doctype|html|head|body)\b/i.test(text);

function toQuotes(text, source) {
  if (looksLikeHtml(text)) throw new Error(`${source}: вместо сборника пришла HTML-страница`);
  const quotes = parseQuotes(text);
  if (!quotes.length) throw new Error(`${source}: сборник пустой`);
  return quotes;
}

async function readLocal(files) {
  const misses = [];
  for (const file of files) {
    try {
      return toQuotes(await readFile(file, 'utf8'), file);
    } catch (err) {
      misses.push(err.code === 'ENOENT' ? `${file}: файла нет` : err.message);
    }
  }
  throw new Error(misses.join('; '));
}

async function fetchFromSite(origin, fetchImpl) {
  const source = `${SITE_PATH} на сайте`;
  const res = await fetchImpl(new URL(SITE_PATH, origin), { signal: AbortSignal.timeout(SITE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
  if (res.redirected && new URL(res.url).origin !== new URL(origin).origin) {
    throw new Error(`${source}: перенаправило на другой адрес (${new URL(res.url).origin}), похоже на страницу входа`);
  }
  return toQuotes(await res.text(), source);
}

/** Фабрика нужна тестам: у каждого свой кэш и свои пути. В коде используется готовый loadCollection ниже. */
export function createCollectionLoader({ candidates = localCandidates, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  let cached = null; // живёт столько же, сколько инстанс функции

  return function load(origin) {
    cached ??= readLocal(candidates())
      .catch(async (localError) => {
        try {
          return await fetchFromSite(origin, fetchImpl);
        } catch (siteError) {
          throw new Error(`в пакете функции: ${localError.message}. Через сайт: ${siteError.message}`);
        }
      })
      .catch((err) => {
        cached = null; // неудачу не запоминаем
        throw err;
      });
    return cached;
  };
}

export const loadCollection = createCollectionLoader();
