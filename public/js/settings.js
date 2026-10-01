const SETTINGS_KEY = 'd127.settings.v1';
const LAST_KEY = 'd127.last.v1';

export const SOURCES = ['collection', 'llm'];

export const DEFAULT_SETTINGS = {
  source: 'collection', // 'collection' | 'llm'
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

export function loadSettings() {
  const stored = read(SETTINGS_KEY);
  return { source: SOURCES.includes(stored?.source) ? stored.source : DEFAULT_SETTINGS.source };
}

/** Возвращает false, если браузер не дал записать (переполнено хранилище, приватный режим). */
export function saveSettings(patch) {
  return write(SETTINGS_KEY, { ...loadSettings(), ...patch });
}

/**
 * Старые версии хранили здесь личные API-ключи, модели и примеры цитат. Ключ теперь лежит на сервере,
 * поэтому всё лишнее стираем: лишний ключ в localStorage зря доступен любому скрипту на странице.
 */
export function purgeLegacySettings() {
  const stored = read(SETTINGS_KEY);
  if (stored && Object.keys(stored).some((key) => key !== 'source')) write(SETTINGS_KEY, loadSettings());
}

export const loadLast = () => read(LAST_KEY);
export const saveLast = (last) => write(LAST_KEY, last);
