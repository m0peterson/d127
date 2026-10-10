/** Модели OpenRouter в порядке основной и резервных. Общий список для интерфейса и функции. */
export const MODEL_OPTIONS = Object.freeze([
  Object.freeze({ id: 'meta/muse-spark-1.3-contributor', label: 'Muse Spark 1.3 Contributor', reasoning: 'high' }),
  Object.freeze({ id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', reasoning: 'high' }),
  Object.freeze({ id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', reasoning: 'xhigh' }),
]);

export const DEFAULT_MODEL = MODEL_OPTIONS[0].id;

/** Выбранная модель — первая; резервные берутся после неё, затем приложение использует сборник. */
export function getModelChain(model = DEFAULT_MODEL) {
  const index = MODEL_OPTIONS.findIndex((option) => option.id === model);
  return index < 0 ? [] : MODEL_OPTIONS.slice(index);
}
