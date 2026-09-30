/**
 * Модуль генерации цитат через LLM. Сейчас работает только мок.
 *
 * Контракт провайдера:
 *   generate(request) -> Promise<{ text: string, meta: object }>
 *
 * request = {
 *   d127, d3,        результат броска
 *   anchor,          цитата из сборника в этом слоте (тема-якорь), может быть undefined
 *   examples,        string[] шаблоны цитат, которые пользователь залил в настройках
 *   apiKey, model,   из настроек
 *   signal,          AbortSignal, необязательный
 * }
 *
 * Чтобы подключить настоящий провайдер:
 *   1. реализуй generate() у записи `openrouter` ниже и поставь ready: true;
 *   2. в netlify.toml CSP уже разрешает connect-src к openrouter.ai;
 *   3. app.js и настройки менять не нужно, они ходят только через generateQuote().
 */

export const SYSTEM_PROMPT = [
  'Ты пишешь короткие мемные цитаты дня в стиле сборника цитат Стэтхема:',
  'сухо, жёстко, по делу, без мата, одна-две фразы.',
  'Ниже примеры. Копировать их нельзя, нужна новая цитата в том же духе.',
].join(' ');

/** Собирает сообщения в формате chat completions. Один и тот же промпт для любого провайдера. */
export function buildMessages({ d127, d3, anchor, examples }) {
  const shots = examples.length
    ? examples.map((line, i) => `${i + 1}. ${line}`).join('\n')
    : '(примеров нет, опирайся на стиль из инструкции)';
  const topic = anchor
    ? `Тема-якорь (не повторяй дословно, только тема и настроение): «${anchor}»`
    : 'Тема свободная.';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Примеры:\n${shots}\n\n${topic}\nБросок: страница = ${d127}, строка = ${d3}.\nВерни только текст цитаты.`,
    },
  ];
}

const delay = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

async function mockGenerate(request) {
  await delay(700, request.signal);
  const messages = buildMessages(request);
  const pool = request.examples.length ? request.examples : [request.anchor].filter(Boolean);
  const text = pool.length
    ? pool[(request.d127 * 3 + request.d3) % pool.length]
    : 'Мок работает, но примеров нет. Добавь цитаты в настройках, и тут появится что-нибудь осмысленное.';
  return { text, meta: { provider: 'mock', mock: true, model: request.model || 'mock', messages } };
}

async function openrouterGenerate() {
  // Заготовка для настоящей интеграции:
  //   POST https://openrouter.ai/api/v1/chat/completions
  //   Authorization: Bearer <apiKey>
  //   body: { model, messages: buildMessages(request) }
  //   ответ: choices[0].message.content
  throw new Error('OpenRouter ещё не подключён. Реализуй generate() в js/llm.js.');
}

export const PROVIDERS = {
  mock: { id: 'mock', label: 'Мок (без сети)', ready: true, generate: mockGenerate },
  openrouter: { id: 'openrouter', label: 'OpenRouter (скоро)', ready: false, generate: openrouterGenerate },
};

export async function generateQuote(providerId, request) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Неизвестный провайдер: ${providerId}`);
  if (!provider.ready) throw new Error(`${provider.label}: провайдер пока не подключён`);
  return provider.generate(request);
}
