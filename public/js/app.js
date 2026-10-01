import { rollBoth, randomInt, D127, D3 } from './dice.js';
import { loadQuotes, pickQuote, parseExamples, MAX_EXAMPLES, SLOTS } from './quotes.js';
import { loadSettings, saveSettings, purgeLegacySettings, loadLast, saveLast } from './settings.js';
import { generateQuote } from './llm.js';

const $ = (id) => document.getElementById(id);
const els = {
  die127: $('die127'), die3: $('die3'), val127: $('val127'), val3: $('val3'),
  slot: $('slot'), card: $('card'), qdate: $('qdate'), qtext: $('qtext'), qsrc: $('qsrc'),
  roll: $('rollBtn'), share: $('shareBtn'), toast: $('toast'),
  dialog: $('settings'), openSettings: $('openSettings'), closeSettings: $('closeSettings'),
  examples: $('examples'), examplesCount: $('examplesCount'),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

let quotes = [];
let current = null; // последний показанный бросок
let busy = false;
let toastTimer;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  // длинные сообщения об ошибках читаются дольше
  const ms = Math.min(9000, Math.max(2600, message.length * 55));
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

async function ensureQuotes() {
  if (quotes.length) return;
  quotes = await loadQuotes();
}

/* отрисовка */

function renderDice(d127, d3) {
  els.val127.textContent = d127;
  els.val3.textContent = d3;
}

function sourceLabel(result) {
  return result.source?.startsWith('llm') ? 'сочинила LLM в духе Стэтхема' : 'по мотивам Стэтхема';
}

function renderResult(result, { animate = false } = {}) {
  renderDice(result.d127, result.d3);
  els.slot.textContent = `Слот ${result.slot} из ${SLOTS}`;
  els.qdate.textContent = `Цитата дня · ${dateFormat.format(result.ts)}`;
  els.qtext.textContent = result.text;
  els.qsrc.textContent = sourceLabel(result);
  els.card.classList.remove('empty');
  els.share.hidden = false;
  if (animate) {
    els.card.classList.remove('fresh');
    void els.card.offsetWidth;
    els.card.classList.add('fresh');
  }
}

function renderMessage(message) {
  els.qtext.textContent = message;
  els.qsrc.textContent = '';
  els.card.classList.add('empty');
  els.share.hidden = true;
}

/* бросок */

function tumble(on) {
  for (const die of [els.die127, els.die3]) {
    die.classList.toggle('tumbling', on);
    if (on) die.classList.remove('landed');
  }
}

async function resolveQuote({ d127, d3 }, settings) {
  const anchor = pickQuote(quotes, d127, d3);
  if (settings.source !== 'llm') return { text: anchor.text, source: 'collection', slot: anchor.slot };
  try {
    const text = await generateQuote({ d127, d3, examples: parseExamples(settings.examples) });
    return { text, source: 'llm', slot: anchor.slot };
  } catch (err) {
    toast(`LLM не ответила, показан сборник: ${err.message}`);
    return { text: anchor.text, source: 'collection', slot: anchor.slot };
  }
}

async function roll() {
  if (busy) return;
  busy = true;
  els.roll.setAttribute('aria-disabled', 'true');

  const rolled = rollBoth();
  const settings = loadSettings();
  const duration = reduceMotion.matches ? 300 : 1100;

  // оба кубика крутятся и останавливаются в один момент
  tumble(true);
  navigator.vibrate?.(15);
  const spinner = setInterval(() => {
    els.val127.textContent = randomInt(D127);
    els.val3.textContent = randomInt(D3);
  }, 70);
  const lookup = ensureQuotes().then(() => resolveQuote(rolled, settings));
  lookup.catch(() => {}); // ошибку разберём после остановки кубиков

  await sleep(duration);
  clearInterval(spinner);
  tumble(false);
  renderDice(rolled.d127, rolled.d3);
  for (const die of [els.die127, els.die3]) die.classList.add('landed');
  navigator.vibrate?.(35);
  if (settings.source === 'llm') renderMessage('Генерирую цитату...');

  try {
    const found = await lookup;
    current = { ...rolled, ...found, ts: Date.now() };
    saveLast(current);
    renderResult(current, { animate: true });
  } catch (err) {
    els.slot.textContent = `Слот ? из ${SLOTS}`;
    renderMessage('Сборник цитат не загрузился. Проверь соединение и брось ещё раз.');
    toast(err.message);
  } finally {
    busy = false;
    els.roll.removeAttribute('aria-disabled');
  }
}

/* поделиться */

async function share() {
  if (!current) return;
  const text = `«${current.text}»\n\nСтраница ${current.d127}, строка ${current.d3}. Мемная цитата в духе Стэтхема.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'd127: цитата дня', text, url: location.href });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${location.href}`);
    toast('Скопировано');
  } catch {
    toast('Не удалось поделиться');
  }
}

/* настройки */

function showExamplesCount() {
  const count = parseExamples(els.examples.value).length;
  els.examplesCount.textContent = count
    ? `Уйдёт в модель: ${count} из максимум ${MAX_EXAMPLES}. Для каждого запроса берётся 30 случайных.`
    : 'Пока пусто, поэтому примеры берутся из сборника.';
}

function fillSettingsForm() {
  const { source, examples } = loadSettings();
  for (const radio of document.querySelectorAll('input[name="source"]')) radio.checked = radio.value === source;
  els.examples.value = examples;
  showExamplesCount();
}

function initSettings() {
  fillSettingsForm();

  els.openSettings.addEventListener('click', () => {
    fillSettingsForm();
    els.dialog.showModal();
  });
  els.closeSettings.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('click', (e) => {
    if (e.target === els.dialog) els.dialog.close(); // тап по затемнению
  });

  els.examples.addEventListener('input', () => {
    showExamplesCount();
    if (!saveSettings({ examples: els.examples.value })) {
      toast('Браузер не дал сохранить настройки: кончилось место или включён приватный режим');
    }
  });

  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => {
      if (!saveSettings({ source: radio.value })) {
        toast('Браузер не дал сохранить настройки: кончилось место или включён приватный режим');
      }
    });
  }
}

/* запуск */

function restoreLast() {
  const last = loadLast();
  if (last?.text && last.d127 && last.d3) {
    current = last;
    renderResult(last);
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

els.roll.addEventListener('click', roll);
els.share.addEventListener('click', share);
purgeLegacySettings();
initSettings();
restoreLast();
registerServiceWorker();
ensureQuotes().catch(() => {}); // прогрев, повторная попытка будет при броске
