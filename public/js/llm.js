/**
 * Генерация цитат через LLM.
 *
 * Контракт провайдера:
 *   generate(request) -> Promise<{ text: string, meta: { provider, model, messages } }>
 *
 * request = {
 *   anchor,          цитата из сборника в слоте броска (тема-якорь), может быть undefined
 *   examples,        string[] примеры цитат из настроек, в промпт уходит случайная выборка
 *   apiKey, model,   из настроек выбранного провайдера
 *   signal,          AbortSignal, необязательный
 * }
 *
 * Провайдеры OpenRouter и OpenCode Go говорят на OpenAI-совместимом chat completions,
 * поэтому у них общая реализация. Запрос идёт прямо из браузера, ключ уходит только на их домен.
 */

import { randomInt } from './dice.js';

export const SYSTEM_PROMPT = [
  'Ты сочиняешь мемные «цитаты Джейсона Стэтхэма»: пафосные фразы, которые звучат как глубокая мужская мудрость,',
  'а на деле тупые, абсурдные, смешные и кринжовые. Так и задумано: чем нелепее логика и чем серьёзнее лицо, тем лучше.',
  'Держи ту же подачу, что в примерах: интонацию, длину, ритм и фирменные ходы',
  '(ложная мудрость, бытовой абсурд, поворот в конце, который всё портит).',
  'Копировать примеры и пересказывать их нельзя, нужна новая цитата с новой шуткой.',
  'Формат: одна-три короткие фразы на русском, без пояснений, без кавычек, без подписи.',
  'Не используй мат, если его нет в примерах.',
].join(' ');

/** Сколько примеров уходит в один запрос. Файл на тысячу цитат целиком раздул бы промпт и счёт. */
export const EXAMPLES_PER_REQUEST = 30;
const EXAMPLE_MAX_CHARS = 300;
const REQUEST_TIMEOUT_MS = 40_000;
const MAX_TOKENS = 1500; // запас на думающие модели: рассуждения съедают часть лимита

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

/** Собирает сообщения в формате chat completions. Один и тот же промпт для любого провайдера. */
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

/** Приводит то, что пользователь вставил в поле модели, к id, который понимает API. */
export const normalizers = {
  // со страницы модели можно скопировать и slug, и целую ссылку
  openrouter: (raw) =>
    raw
      .trim()
      .replace(/^https?:\/\/openrouter\.ai\//i, '')
      .replace(/^models\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, ''),
  // в opencode id моделей пишут как `opencode-go/<модель>`, API ждёт просто `<модель>`
  opencodego: (raw) => raw.trim().replace(/^opencode(?:-go)?\//i, ''),
  mock: (raw) => raw.trim(),
};

export const normalizeModel = (providerId, raw) => (normalizers[providerId] ?? normalizers.mock)(raw ?? '');

/* транспорт */

const STATUS_HINTS = {
  400: 'запрос отклонён, проверь название модели',
  401: 'ключ не принят, проверь его в настройках',
  402: 'на ключе закончились деньги или лимит',
  403: 'доступ запрещён: у ключа нет прав или модель ему недоступна',
  404: 'модель не найдена, проверь название',
  408: 'сервер не дождался запроса',
  429: 'слишком много запросов или кончился лимит, подожди немного',
};

function httpError(label, status, detail) {
  const hint = STATUS_HINTS[status] ?? `ошибка сервера (HTTP ${status})`;
  const extra = detail ? `: ${String(detail).slice(0, 160)}` : '';
  return new Error(`${label}: ${hint}${extra}`);
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

/** AbortSignal, который срабатывает по таймауту или по внешнему сигналу. */
function withTimeout(outer, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), ms);
  const onOuter = () => controller.abort(outer.reason);
  if (outer?.aborted) onOuter();
  else outer?.addEventListener('abort', onOuter, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
  };
}

/**
 * POST на chat completions. `urls` пробуются по очереди, но только если запрос не дошёл до сервера
 * (сеть, CORS). Любой ответ сервера, в том числе ошибка, заканчивает перебор.
 */
export async function chatCompletion({ label, urls, apiKey, body, signal, onReach }) {
  const { signal: guard, done } = withTimeout(signal, REQUEST_TIMEOUT_MS);
  try {
    const failures = [];
    for (const url of urls) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: guard,
        });
      } catch (err) {
        if (guard.aborted) throw err;
        failures.push(err.message);
        continue;
      }
      const raw = await res.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        /* не JSON: ниже покажем кусок текста */
      }
      if (res.status === 404 && !data) {
        // HTML-страница 404 вместо JSON: такого маршрута нет (например, прокси при локальном запуске)
        failures.push(`${url.replace(/^https?:\/\/[^/]+/, '')}: HTTP 404`);
        continue;
      }
      onReach?.(url);
      const apiMessage = data?.error?.message ?? data?.error ?? data?.message;
      if (!res.ok) throw httpError(label, res.status, typeof apiMessage === 'string' ? apiMessage : raw);
      if (data?.error) throw new Error(`${label}: ${typeof apiMessage === 'string' ? apiMessage : 'модель вернула ошибку'}`);
      if (!data) throw new Error(`${label}: ответ не похож на JSON: ${raw.slice(0, 120)}`);
      const text = cleanQuote(extractContent(data));
      if (!text) {
        throw new Error(
          `${label}: модель вернула пустой ответ. Думающая модель могла потратить весь лимит токенов на рассуждения, попробуй модель без них`,
        );
      }
      return { text, url };
    }
    throw new Error(`${label}: запрос не дошёл до сервера (${failures.join('; ') || 'нет сети'})`);
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || guard.aborted) {
      if (signal?.aborted) throw err; // отмену пользователя не маскируем
      throw new Error(`${label}: нет ответа за ${REQUEST_TIMEOUT_MS / 1000} секунд`);
    }
    throw err;
  } finally {
    done();
  }
}

/* провайдеры */

function chatProvider({ id, label, urls, onReach }) {
  return {
    id,
    label,
    ready: true,
    needsKey: true,
    async generate(request) {
      const apiKey = (request.apiKey ?? '').trim();
      const model = normalizeModel(id, request.model);
      if (!apiKey) throw new Error(`${label}: вставь API-ключ в настройках`);
      if (!model) throw new Error(`${label}: впиши название модели в настройках`);
      const messages = buildMessages(request);
      const { text } = await chatCompletion({
        label,
        urls: urls(),
        apiKey,
        body: { model, messages, max_tokens: MAX_TOKENS },
        signal: request.signal,
        onReach,
      });
      return { text, meta: { provider: id, model, messages } };
    },
  };
}

// Прямой вызов из браузера зависит от CORS на стороне сервиса. Если он не пройдёт, запрос уйдёт через
// same-origin прокси, который описан в netlify.toml. Сработавший путь запоминаем до перезагрузки страницы.
const OPENCODE_GO_DIRECT = 'https://opencode.ai/zen/go/v1/chat/completions';
const OPENCODE_GO_PROXY = '/api/opencode-go/chat/completions';
let goViaProxy = false;

const openrouter = chatProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  urls: () => ['https://openrouter.ai/api/v1/chat/completions'],
});

const opencodego = chatProvider({
  id: 'opencodego',
  label: 'OpenCode Go',
  urls: () => (goViaProxy ? [OPENCODE_GO_PROXY, OPENCODE_GO_DIRECT] : [OPENCODE_GO_DIRECT, OPENCODE_GO_PROXY]),
  onReach: (url) => {
    goViaProxy = url === OPENCODE_GO_PROXY;
  },
});

const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/** Без сети: отдаёт один из примеров. Нужен, чтобы проверять интерфейс и не тратить деньги. */
const mock = {
  id: 'mock',
  label: 'Мок (без сети, проверка интерфейса)',
  ready: true,
  needsKey: false,
  async generate(request) {
    await delay(700, request.signal);
    const messages = buildMessages(request);
    const pool = request.examples.length ? request.examples : [request.anchor].filter(Boolean);
    const text = pool.length
      ? pool[randomInt(pool.length) - 1]
      : 'Мок работает, но примеров нет. Добавь цитаты в настройках, и тут появится что-нибудь осмысленное.';
    return { text, meta: { provider: 'mock', model: 'mock', messages } };
  },
};

export const PROVIDERS = { openrouter, opencodego, mock };

export async function generateQuote(providerId, request) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Неизвестный провайдер: ${providerId}`);
  return provider.generate(request);
}
