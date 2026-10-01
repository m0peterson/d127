/**
 * POST /api/quote  { "d127": 1..127, "d3": 1..3 }  ->  { "text": "..." }
 *
 * Единственное место, где живёт LLM-ключ. Настройки берутся из переменных окружения Netlify:
 *   LLM_PROVIDER  openrouter | opencodego | mock   (по умолчанию openrouter)
 *   LLM_API_KEY   ключ провайдера
 *   LLM_MODEL     id модели
 *
 * Браузер присылает только два числа. Промпт, примеры, модель и лимит токенов задаёт сервер,
 * поэтому эту функцию нельзя использовать как бесплатный универсальный чат.
 * Частоту запросов ограничивает Netlify (rateLimit ниже), потолок расходов задаётся у провайдера.
 */

import { D127, D3 } from '../../public/js/dice.js';
import { pickQuote } from '../../public/js/quotes.js';
import { loadCollection } from '../lib/collection.mjs';
import { LlmError, PROVIDER_IDS, generateQuote } from '../lib/llm.mjs';

const MAX_BODY_BYTES = 1024;

function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const isDie = (value, sides) => Number.isInteger(value) && value >= 1 && value <= sides;

export default async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Только POST' }, { Allow: 'POST' });
  // application/json нельзя отправить с чужой страницы без предварительного запроса (CORS preflight), а на него функция не отвечает
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return reply(415, { error: 'Нужен Content-Type: application/json' });
  }
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) return reply(413, { error: 'Слишком большой запрос' });

  let body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { error: 'Слишком большой запрос' });
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'Тело запроса не похоже на JSON' });
  }
  const { d127, d3 } = body ?? {};
  if (!isDie(d127, D127) || !isDie(d3, D3)) {
    return reply(400, { error: `Нужны целые d127 от 1 до ${D127} и d3 от 1 до ${D3}` });
  }

  const provider = (Netlify.env.get('LLM_PROVIDER') || 'openrouter').trim().toLowerCase();
  const apiKey = (Netlify.env.get('LLM_API_KEY') || '').trim();
  const model = (Netlify.env.get('LLM_MODEL') || '').trim();
  const problems = [];
  if (!PROVIDER_IDS.includes(provider)) {
    problems.push(`LLM_PROVIDER=«${provider}» неизвестен, допустимы ${PROVIDER_IDS.join(', ')}`);
  } else if (provider !== 'mock') {
    if (!apiKey) problems.push('не задана переменная LLM_API_KEY');
    if (!model) problems.push('не задана переменная LLM_MODEL');
  }
  if (problems.length) {
    // Посетителю причина не нужна, а владельцу нужна вся сразу: каждая правка переменной требует нового деплоя
    console.error(
      `Функция quote не настроена: ${problems.join('; ')}. ` +
        'Значения переменных Netlify применяются только к новым деплоям: если переменная уже добавлена, задеплой сайт заново.',
    );
    return reply(503, { error: 'Генерация не настроена на сервере', code: 'not_configured' });
  }

  let quotes;
  try {
    quotes = await loadCollection(new URL(req.url).origin);
  } catch (err) {
    console.error(`Не удалось загрузить сборник: ${err.message}`);
    return reply(503, { error: 'Сборник недоступен на сервере', code: 'collection_unavailable' });
  }

  const anchor = pickQuote(quotes, d127, d3);
  // саму цитату-тему в примеры не кладём: модель увидела бы её дважды
  const examples = quotes.filter((_, i) => i !== anchor.index - 1);

  try {
    const text = await generateQuote({ provider, apiKey, model, anchor: anchor.text, examples });
    return reply(200, { text });
  } catch (err) {
    // подробности только в логах Netlify (Logs -> Functions), посетителю уходит нейтральный текст
    const message = String(err.message);
    const detail = apiKey ? message.replaceAll(apiKey, '***') : message;
    console.error(`LLM (${provider}) не ответила${err instanceof LlmError && err.status ? `, HTTP ${err.status}` : ''}: ${detail}`);
    return reply(502, { error: 'Модель не ответила', code: 'model_failed' });
  }
};

export const config = {
  path: '/api/quote',
  method: 'POST',
  // Не больше 10 запросов в минуту с одного IP, дальше Netlify сам отвечает 429.
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: ['ip', 'domain'] },
};
