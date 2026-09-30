const SETTINGS_KEY = 'd127.settings.v1';
const LAST_KEY = 'd127.last.v1';

export const DEFAULT_SETTINGS = {
  source: 'collection', // 'collection' | 'llm'
  provider: 'mock', // ключ из PROVIDERS в llm.js
  apiKey: '',
  model: '',
  examples: '', // шаблоны цитат для LLM, по одной на строку
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
  return { ...DEFAULT_SETTINGS, ...(read(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  write(SETTINGS_KEY, next);
  return next;
}

export function resetSettings() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    /* хранилище недоступно, сбрасывать нечего */
  }
  return { ...DEFAULT_SETTINGS };
}

export function exampleList(settings) {
  return settings.examples
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const loadLast = () => read(LAST_KEY);
export const saveLast = (last) => write(LAST_KEY, last);
