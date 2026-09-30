const SETTINGS_KEY = 'd127.settings.v1';
const LAST_KEY = 'd127.last.v1';

export const DEFAULT_SETTINGS = {
  source: 'collection', // 'collection' | 'llm'
  provider: 'openrouter', // ключ из PROVIDERS в llm.js
  // ключ и модель у каждого провайдера свои: поля называются `${id}Key` и `${id}Model`
  openrouterKey: '',
  openrouterModel: '',
  opencodegoKey: '',
  opencodegoModel: '',
  examples: '', // примеры цитат для LLM, по одной на строку
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

/** В первой версии были общие поля apiKey и model, ключ тогда просили от OpenRouter. */
function migrate(stored) {
  if (!stored) return {};
  const { apiKey, model, ...rest } = stored;
  if (apiKey && !rest.openrouterKey) rest.openrouterKey = apiKey;
  if (model && !rest.openrouterModel) rest.openrouterModel = model;
  return rest;
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...migrate(read(SETTINGS_KEY)) };
}

/** Возвращает false, если браузер не дал записать (переполнено хранилище, приватный режим). */
export function saveSettings(patch) {
  return write(SETTINGS_KEY, { ...loadSettings(), ...patch });
}

export function resetSettings() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    /* хранилище недоступно, сбрасывать нечего */
  }
  return { ...DEFAULT_SETTINGS };
}

/** Ключ и модель выбранного провайдера в том виде, в каком их ждёт generateQuote(). */
export function providerCreds(settings, providerId) {
  return {
    apiKey: settings[`${providerId}Key`] ?? '',
    model: settings[`${providerId}Model`] ?? '',
  };
}

const LIST_MARK = /^(?:\d{1,4}[.)]|[-–—•*·])\s+/;
const QUOTE_PAIRS = { '«': '»', '“': '”', '„': '“', '"': '"' };
const SIGNATURE = /\s*[—–-]\s*(?:Джейсон\s+)?Ст[эеа]т?х?[эе]м\s*\.?$/iu;

/** Одна строка примера без мусора: нумерации, маркера списка, кавычек и подписи «— Стэтхэм». */
export function cleanExample(line) {
  let s = line.trim().replace(LIST_MARK, '');
  if (s.length > 1 && QUOTE_PAIRS[s[0]] === s.at(-1)) s = s.slice(1, -1).trim();
  const unsigned = s.replace(SIGNATURE, '');
  if (unsigned.length > 12) s = unsigned.trim();
  if (s.length > 1 && QUOTE_PAIRS[s[0]] === s.at(-1)) s = s.slice(1, -1).trim();
  return s;
}

/** Текст из поля или файла превращается в список уникальных цитат. */
export function parseExamples(text) {
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const clean = cleanExample(line);
    if (clean) seen.add(clean);
  }
  return [...seen];
}

export const exampleList = (settings) => parseExamples(settings.examples);

export const loadLast = () => read(LAST_KEY);
export const saveLast = (last) => write(LAST_KEY, last);
