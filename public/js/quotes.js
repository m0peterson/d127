import { D127, D3 } from './dice.js';

export const SLOTS = D127 * D3;

/** Слот от 0 до 380: d127 выбирает тройку, d3 выбирает цитату внутри тройки. */
export function slotIndex(d127, d3) {
  return (d127 - 1) * D3 + (d3 - 1);
}

export function parseQuotes(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

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
