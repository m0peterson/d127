import { rollBoth, randomInt, D127, D3 } from './dice.js';
import { loadQuotes, pickQuote, SLOTS } from './quotes.js';
import {
  loadSettings, saveSettings, resetSettings, exampleList, parseExamples, providerCreds, loadLast, saveLast,
} from './settings.js';
import { PROVIDERS, generateQuote, normalizeModel } from './llm.js';

const $ = (id) => document.getElementById(id);
const els = {
  die127: $('die127'), die3: $('die3'), val127: $('val127'), val3: $('val3'),
  slot: $('slot'), card: $('card'), qdate: $('qdate'), qtext: $('qtext'), qsrc: $('qsrc'),
  roll: $('rollBtn'), share: $('shareBtn'), toast: $('toast'),
  dialog: $('settings'), openSettings: $('openSettings'), closeSettings: $('closeSettings'),
  provider: $('provider'), examples: $('examples'), examplesFile: $('examplesFile'),
  dropzone: $('dropzone'), clearExamples: $('clearExamples'),
  examplesCount: $('examplesCount'), testGen: $('testGen'), testOut: $('testOut'),
  testText: $('testText'), testPrompt: $('testPrompt'), resetSettings: $('resetSettings'),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

let quotes = [];
let current = null; // последний показанный бросок
let busy = false;
let toastTimer;

const MAX_FILE_BYTES = 1024 * 1024;

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
  if (result.source === 'collection') return 'по мотивам Стэтхема';
  if (result.source === 'llm:mock') return 'мок LLM в духе Стэтхема';
  return result.model ? `сочинила модель ${result.model}` : 'сочинила LLM в духе Стэтхема';
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

function llmRequest(settings, anchor) {
  return { anchor, examples: exampleList(settings), ...providerCreds(settings, settings.provider) };
}

async function resolveQuote({ d127, d3 }, settings) {
  const anchor = pickQuote(quotes, d127, d3);
  if (settings.source !== 'llm') return { text: anchor.text, source: 'collection', slot: anchor.slot };
  try {
    const res = await generateQuote(settings.provider, llmRequest(settings, anchor.text));
    return { text: res.text, source: `llm:${settings.provider}`, model: res.meta.model, slot: anchor.slot };
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

function syncExamplesCount() {
  const count = parseExamples(els.examples.value).length;
  els.examplesCount.textContent = `Примеров: ${count}`;
  els.clearExamples.hidden = !els.examples.value;
}

function showProviderGroup(providerId) {
  for (const group of document.querySelectorAll('[data-provider]')) {
    group.hidden = group.dataset.provider !== providerId;
  }
}

function fillSettingsForm() {
  const s = loadSettings();
  for (const radio of document.querySelectorAll('input[name="source"]')) radio.checked = radio.value === s.source;
  els.provider.value = PROVIDERS[s.provider] ? s.provider : 'openrouter';
  for (const p of Object.values(PROVIDERS)) {
    if (!p.needsKey) continue;
    $(`${p.id}Key`).value = s[`${p.id}Key`];
    $(`${p.id}Model`).value = s[`${p.id}Model`];
  }
  showProviderGroup(els.provider.value);
  els.examples.value = s.examples;
  syncExamplesCount();
}

function saveOrWarn(patch) {
  if (!saveSettings(patch)) toast('Браузер не дал сохранить настройки: кончилось место или включён приватный режим');
}

/* примеры цитат: файлы, перетаскивание, вставка */

async function readTextFile(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes); // старые русские .txt
  }
}

const isTextFile = (file) => file.type.startsWith('text/') || /\.(txt|md|csv|text)$/i.test(file.name);

/** Дописывает в поле только те цитаты, которых там ещё нет. Уже набранный текст не трогает. */
function appendExamples(text) {
  const have = new Set(parseExamples(els.examples.value));
  const fresh = parseExamples(text).filter((line) => !have.has(line));
  if (fresh.length) {
    const current = els.examples.value.replace(/\s+$/, '');
    els.examples.value = (current ? `${current}\n` : '') + fresh.join('\n');
    saveOrWarn({ examples: els.examples.value });
    syncExamplesCount();
  }
  return fresh.length;
}

async function addExamplesFromFiles(fileList) {
  const chunks = [];
  const skipped = [];
  for (const file of fileList) {
    if (!isTextFile(file)) skipped.push(`${file.name} (не текст)`);
    else if (file.size > MAX_FILE_BYTES) skipped.push(`${file.name} (больше 1 МБ)`);
    else chunks.push(await readTextFile(file));
  }
  const added = chunks.length ? appendExamples(chunks.join('\n')) : 0;
  const parts = [];
  if (chunks.length) parts.push(added ? `Добавлено цитат: ${added}` : 'Новых цитат нет, всё уже в списке');
  if (skipped.length) parts.push(`Пропущено: ${skipped.join(', ')}`);
  toast(parts.join('. '));
}

function initDropzone() {
  const zone = els.dropzone;
  const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');

  // Файл, брошенный мимо зоны, иначе открылся бы в этой же вкладке и увёл бы со страницы
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
  }

  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) {
      await addExamplesFromFiles(files);
      return;
    }
    const text = e.dataTransfer?.getData('text/plain'); // выделенный текст, перетащенный из другой вкладки
    if (text) toast(appendExamples(text) ? 'Текст добавлен' : 'Новых цитат нет, всё уже в списке');
  });

  els.examplesFile.addEventListener('change', async () => {
    const files = [...els.examplesFile.files];
    els.examplesFile.value = ''; // чтобы тот же файл можно было выбрать ещё раз
    if (files.length) await addExamplesFromFiles(files);
  });

  els.clearExamples.addEventListener('click', () => {
    if (!confirm('Стереть весь список примеров?')) return;
    els.examples.value = '';
    saveOrWarn({ examples: '' });
    syncExamplesCount();
  });
}

function initSettings() {
  for (const p of Object.values(PROVIDERS)) els.provider.append(new Option(p.label, p.id));
  fillSettingsForm();

  els.openSettings.addEventListener('click', () => {
    fillSettingsForm();
    els.testOut.hidden = true;
    els.dialog.showModal();
  });
  els.closeSettings.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('click', (e) => {
    if (e.target === els.dialog) els.dialog.close(); // тап по затемнению
  });

  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => saveOrWarn({ source: radio.value }));
  }
  els.provider.addEventListener('change', () => {
    saveOrWarn({ provider: els.provider.value });
    showProviderGroup(els.provider.value);
  });

  for (const p of Object.values(PROVIDERS)) {
    if (!p.needsKey) continue;
    const key = $(`${p.id}Key`);
    const model = $(`${p.id}Model`);
    key.addEventListener('input', () => saveOrWarn({ [`${p.id}Key`]: key.value.trim() }));
    model.addEventListener('input', () => saveOrWarn({ [`${p.id}Model`]: model.value.trim() }));
    // после вставки приводим к чистому id: из ссылки, с приставкой и т.п.
    model.addEventListener('change', () => {
      model.value = normalizeModel(p.id, model.value);
      saveOrWarn({ [`${p.id}Model`]: model.value });
    });
  }

  els.examples.addEventListener('input', () => {
    saveOrWarn({ examples: els.examples.value });
    syncExamplesCount();
  });
  initDropzone();

  els.testGen.addEventListener('click', testGeneration);
  els.resetSettings.addEventListener('click', () => {
    if (!confirm('Стереть ключи, модели и примеры цитат из этого браузера?')) return;
    resetSettings();
    fillSettingsForm();
    els.testOut.hidden = true;
    toast('Настройки стёрты');
  });
}

async function testGeneration() {
  const settings = loadSettings();
  const { d127, d3 } = current ?? rollBoth();
  els.testGen.disabled = true;
  els.testOut.hidden = false;
  els.testText.textContent = 'Генерирую...';
  els.testPrompt.textContent = '';
  try {
    await ensureQuotes().catch(() => {}); // якорь необязателен
    const anchor = quotes.length ? pickQuote(quotes, d127, d3).text : undefined;
    const res = await generateQuote(settings.provider, llmRequest(settings, anchor));
    els.testText.textContent = res.text;
    els.testPrompt.textContent = JSON.stringify(res.meta.messages, null, 2);
  } catch (err) {
    els.testText.textContent = `Ошибка: ${err.message}`;
  } finally {
    els.testGen.disabled = false;
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
initSettings();
restoreLast();
registerServiceWorker();
ensureQuotes().catch(() => {}); // прогрев, повторная попытка будет при броске
