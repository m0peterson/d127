/**
 * Генерация цитат через LLM. Работает только на сервере (Netlify Function), ключ в браузер не попадает.
 *
 *   generateQuote({ provider, apiKey, model, anchor, examples }) -> Promise<string>
 *
 * Провайдеры OpenRouter и OpenCode Go говорят на OpenAI-совместимом chat completions,
 * поэтому у них общая реализация. Мок нужен для проверки проводки без трат.
 */

import { randomInt } from '../../public/js/dice.js';

export const SYSTEM_PROMPT = [
  'Ты сочиняешь мемные «цитаты Джейсона Стэтхэма»: пафосные фразы, которые звучат как глубокая мужская мудрость,',
  'а на деле тупые, абсурдные, смешные и кринжовые. Так и задумано: чем нелепее логика и чем серьёзнее лицо, тем лучше.',
  'Держи ту же подачу, что в примерах: интонацию, длину, ритм и фирменные ходы',
  '(ложная мудрость, бытовой абсурд, поворот в конце, который всё портит).',
  'Копировать примеры и пересказывать их нельзя, нужна новая цитата с новой шуткой.',
  'Формат: одна-три короткие фразы на русском, без пояснений, без кавычек, без подписи.',
  'Не используй мат, если его нет в примерах.',
].join(' ');

/** Сколько примеров уходит в один запрос. Держит размер промпта, а с ним и счёт, постоянным. */
export const EXAMPLES_PER_REQUEST = 30;
const EXAMPLE_MAX_CHARS = 300;
const MAX_TOKENS = 1500; // запас на думающие модели: рассуждения съедают часть лимита. Меньше значение, меньше потолок расходов
const UPSTREAM_TIMEOUT_MS = 25_000;

/** Случайные `limit` примеров без повторов (частичный Фишер-Йейтс). `rand(n)` даёт число от 1 до n. */
export function sampleExamples(examples, limit = EXAMPLES_PER_REQUEST, rand = randomInt) {
  const pool = [...examples];
  const count = Math.min(limit, pool.length);
  for (let i = 0; i < count; i++) {
    const j = i + rand(pool.length - i) - 1;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Сообщения в формате chat completions. Один и тот же промпт для любого провайдера. */
export function buildMessages({ anchor, examples, rand }) {
  const shots = sampleExamples(examples, EXAMPLES_PER_REQUEST, rand)
    .map((line, i) => `${i + 1}. ${line.slice(0, EXAMPLE_MAX_CHARS)}`)
    .join('\n');
  const parts = [];
  parts.push(
    shots
      ? `Примеры хороших цитат:\n${shots}`
      : 'Примеров нет, опирайся на описание стиля из инструкции.',
  );
  parts.push(
    anchor
      ? `Тема: возьми идею и настроение из этой фразы, но саму фразу не повторяй: «${anchor}»`
      : 'Тема свободная.',
  );
  parts.push('Напиши одну новую цитату. Верни только её текст.');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/** Приводит то, что вписано в переменную LLM_MODEL, к id, который понимает API. */
export function normalizeModel(providerId, raw) {
  const value = String(raw ?? '').trim();
  if (providerId === 'openrouter') {
    // со страницы модели можно скопировать и slug, и целую ссылку
    return value
      .replace(/^https?:\/\/openrouter\.ai\//i, '')
      .replace(/^models\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
  if (providerId === 'opencodego') {
    // в opencode id моделей пишут как `opencode-go/<модель>`, API ждёт просто `<модель>`
    return value.replace(/^opencode(?:-go)?\//i, '');
  }
  return value;
}

/** Текст ответа модели без служебного мусора: блоков <think>, метки «Цитата:» и обрамляющих кавычек. */
export function cleanQuote(raw) {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*(?:цитата|quote)\s*:\s*/i, '')
    .trim();
  const pairs = { '«': '»', '“': '”', '"': '"' };
  if (text.length > 1 && pairs[text[0]] === text.at(-1) && !text.slice(1, -1).includes(text[0])) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function extractContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? '').join('');
  return '';
}

/** Ошибка обращения к провайдеру. Текст уходит только в логи функции, посетителю он не показывается. */
export class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

async function chatCompletion({ url, apiKey, body }) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new LlmError(`нет ответа за ${UPSTREAM_TIMEOUT_MS / 1000} секунд`);
    throw new LlmError(`запрос не дошёл до сервера: ${err?.message ?? err}`);
  }

  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* не JSON: ниже покажем кусок текста */
  }
  const apiMessage = data?.error?.message ?? data?.error ?? data?.message;
  const detail = typeof apiMessage === 'string' ? apiMessage : raw;
  if (!res.ok) throw new LlmError(`HTTP ${res.status}: ${detail.slice(0, 200)}`, res.status);
  if (data?.error) throw new LlmError(`провайдер вернул ошибку: ${detail.slice(0, 200)}`);
  if (!data) throw new LlmError(`ответ не похож на JSON: ${raw.slice(0, 120)}`);

  const text = cleanQuote(extractContent(data));
  if (!text) {
    throw new LlmError('пустой ответ модели. Думающая модель могла потратить весь лимит токенов на рассуждения, возьми модель без них');
  }
  return text;
}

const CHAT_URLS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  opencodego: 'https://opencode.ai/zen/go/v1/chat/completions',
};

export const PROVIDER_IDS = [...Object.keys(CHAT_URLS), 'mock'];

/** Без сети: отдаёт один из примеров. Нужен, чтобы проверить проводку сайта и не тратить деньги. */
function mockQuote({ anchor, examples }) {
  const pool = examples.length ? examples : [anchor].filter(Boolean);
  return pool.length ? pool[randomInt(pool.length) - 1] : 'Мок работает, но примеров нет.';
}

export async function generateQuote({ provider, apiKey, model, anchor, examples, rand }) {
  if (provider === 'mock') return mockQuote({ anchor, examples });
  const url = CHAT_URLS[provider];
  if (!url) throw new LlmError(`неизвестный LLM_PROVIDER: «${provider}», допустимы ${PROVIDER_IDS.join(', ')}`);
  const messages = buildMessages({ anchor, examples, rand });
  return chatCompletion({
    url,
    apiKey,
    body: { model: normalizeModel(provider, model), messages, max_tokens: MAX_TOKENS },
  });
}
