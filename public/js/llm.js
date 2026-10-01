/**
 * Клиент LLM-генерации. Сама генерация идёт на сервере: netlify/functions/quote.mjs.
 * Ключа, модели и промпта в браузере нет, отправляются числа броска и, если задан, список своих цитат-примеров.
 *
 *   generateQuote({ d127, d3, examples? }) -> Promise<string>
 */

const ENDPOINT = '/api/quote';
const REQUEST_TIMEOUT_MS = 30_000;

// Причина от самой функции (поле code в её JSON). По статусу её не угадать: 503 бывает и «не настроена», и «нет сборника»
const CODE_HINTS = new Map([
  ['not_configured', 'генерация не настроена на сервере'],
  ['collection_unavailable', 'сервер не смог загрузить сборник цитат'],
  ['model_failed', 'модель не ответила'],
]);

// Запасной вариант, когда кода нет, то есть ответила не наша функция, а платформа (страница Netlify про лимит, HTML 404)
const STATUS_HINTS = {
  404: 'на этом хосте нет серверной функции (локально её запускает netlify dev)',
  405: 'сервер не принял запрос',
  413: 'запрос слишком большой',
  429: 'слишком много запросов, подожди минуту',
  502: 'модель не ответила',
  503: 'сервер сейчас недоступен',
};

export async function generateQuote({ d127, d3, examples = [] }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(examples.length ? { d127, d3, examples } : { d127, d3 }),
      signal: controller.signal,
    });
    // при ошибках ответ может быть не нашим JSON (страница Netlify про лимит, HTML 404), поэтому парсим осторожно
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = CODE_HINTS.get(data?.code) ?? STATUS_HINTS[res.status] ?? data?.error ?? `ошибка сервера (HTTP ${res.status})`;
      throw new Error(hint);
    }
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) throw new Error('сервер вернул пустой ответ');
    return text;
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`нет ответа за ${REQUEST_TIMEOUT_MS / 1000} секунд`);
    if (err instanceof TypeError) throw new Error('нет связи с сервером');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
