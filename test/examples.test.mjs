import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_EXAMPLES, MAX_EXAMPLE_CHARS, normalizeExamples, parseExamples } from '../public/js/quotes.js';

test('поле настроек: по цитате на строку, нумерация и маркеры отбрасываются', () => {
  const text = '1. Первая\r\n2) Вторая\n- Третья\n• Четвёртая\n\n   \n# комментарий\nПятая';
  assert.deepEqual(parseExamples(text), ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая']);
});

test('повторы, пробелы и управляющие символы убираются, цитата с цифрой в начале остаётся целой', () => {
  assert.deepEqual(normalizeExamples(['а\tб\u0000в', '  а б в ', '2 раза по 2 это 4']), ['а б в', '2 раза по 2 это 4']);
});

test('пределы: длина строки и число строк', () => {
  const [long] = parseExamples('я'.repeat(MAX_EXAMPLE_CHARS + 100));
  assert.equal(long.length, MAX_EXAMPLE_CHARS);
  const many = parseExamples(Array.from({ length: MAX_EXAMPLES + 50 }, (_, i) => `цитата ${i}`).join('\n'));
  assert.equal(many.length, MAX_EXAMPLES);
});

test('не строка на входе не ломает разбор', () => {
  assert.deepEqual(parseExamples(undefined), []);
  assert.deepEqual(parseExamples(null), []);
  assert.deepEqual(parseExamples(''), []);
});
