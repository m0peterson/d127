import { D127, D3 } from './dice.js';

export const SLOTS = D127 * D3;

/** Слот от 0 до 380: страница (d127) выбирает тройку, строка (d3) выбирает цитату внутри тройки. */
export function slotIndex(d127, d3) {
  return (d127 - 1) * D3 + (d3 - 1);
}

export function parseQuotes(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Пределы для своих примеров. Одни и те же числа держат и браузер, и функция, поэтому живут здесь. */
export const MAX_EXAMPLES = 300;
export const MAX_EXAMPLE_CHARS = 300;

const LIST_MARK = /^(?:\d{1,4}[.)]|[-•*·])\s+/;

/**
 * Приводит строки к виду, в котором их можно отдавать модели: без управляющих символов, нумерации и маркеров списка,
 * без пустых, закомментированных и повторяющихся, не длиннее предела, не больше MAX_EXAMPLES штук.
 */
export function normalizeExamples(lines) {
  const seen = new Set();
  const result = [];
  for (const raw of lines) {
    const line = String(raw)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(LIST_MARK, '');
    if (!line || line.startsWith('#') || seen.has(line)) continue;
    seen.add(line);
    result.push(line.slice(0, MAX_EXAMPLE_CHARS));
    if (result.length >= MAX_EXAMPLES) break;
  }
  return result;
}

/** Текст из поля настроек: одна цитата на строку. */
export const parseExamples = (text) => normalizeExamples(String(text ?? '').split(/\r?\n/));

export async function loadQuotes(url = 'data/quotes.txt') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`quotes.txt: HTTP ${res.status}`);
  const quotes = parseQuotes(await res.text());
  if (!quotes.length) throw new Error('quotes.txt пустой');
  return quotes;
}

/**
 * Находит цитату по броску.
 * Если в сборнике меньше 381 строки, пустой слот берёт цитату по кругу (exact = false).
 */
export function pickQuote(quotes, d127, d3) {
  const slot = slotIndex(d127, d3);
  const index = slot % quotes.length;
  return { slot: slot + 1, index: index + 1, text: quotes[index], exact: slot < quotes.length };
}
