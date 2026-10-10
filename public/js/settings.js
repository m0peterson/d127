import { DEFAULT_MODEL, MODEL_OPTIONS } from './models.js';

const SETTINGS_KEY = 'd127.settings.v1';
const LAST_KEY = 'd127.last.v1';

export const SOURCES = ['collection', 'llm'];

export const DEFAULT_SETTINGS = {
  source: 'llm', // 'collection' | 'llm'. Режим LLM сам откатывается на сборник, если модель не ответила
  examples: '', // свои примеры для LLM, по одной цитате на строку. Пусто: примеры берутся из сборника
  model: DEFAULT_MODEL,
  apiKey: '', // личный ключ OpenRouter. Пусто: используется ключ сайта на сервере
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeSettings(stored) {
  return {
    source: SOURCES.includes(stored?.source) ? stored.source : DEFAULT_SETTINGS.source,
    examples: typeof stored?.examples === 'string' ? stored.examples : DEFAULT_SETTINGS.examples,
    model: MODEL_OPTIONS.some(({ id }) => id === stored?.model) ? stored.model : DEFAULT_SETTINGS.model,
    apiKey: typeof stored?.apiKey === 'string' ? stored.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
  };
}

export function loadSettings() {
  return normalizeSettings(read(SETTINGS_KEY));
}

/** Возвращает false, если браузер не дал записать (переполнено хранилище, приватный режим). */
export function saveSettings(patch) {
  return write(SETTINGS_KEY, normalizeSettings({ ...loadSettings(), ...patch }));
}

/**
 * Удаляем устаревшие поля (openrouterKey, provider и другие), не переносим из них старые ключи.
 * Поддерживаемые настройки сохраняются, неизвестная модель и некорректные типы заменяются значениями по умолчанию.
 */
export function purgeLegacySettings() {
  const stored = read(SETTINGS_KEY);
  const settings = normalizeSettings(stored);
  if (stored !== null && JSON.stringify(stored) !== JSON.stringify(settings)) write(SETTINGS_KEY, settings);
}

export const loadLast = () => read(LAST_KEY);
export const saveLast = (last) => write(LAST_KEY, last);
