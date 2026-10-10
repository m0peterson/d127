const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const SUCCESS_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 30_000;
const EFFORTS = new Set(['max', 'xhigh', 'high', 'medium', 'low']);

/** Anonymous model metadata only; failed lookups must not block quote generation. */
export function createModelCatalogLoader({ fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now } = {}) {
  let cached;
  let expiresAt = 0;
  let inFlight;

  return function load() {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(async () => {
      let ttl = SUCCESS_TTL_MS;
      let catalog;
      try {
        const response = await fetchImpl(CATALOG_URL, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          signal: AbortSignal.timeout(1000),
        });
        if (!response.ok) throw new Error('Model catalog unavailable');
        const body = await response.json();
        if (!Array.isArray(body?.data)) throw new Error('Invalid model catalog');
        catalog = new Map();
        for (const model of body.data) {
          if (model && typeof model === 'object' && typeof model.id === 'string' && model.id.trim()) {
            catalog.set(model.id, model);
          }
        }
        if (body.data.length && !catalog.size) throw new Error('Invalid model catalog entries');
      } catch {
        catalog = new Map();
        ttl = FAILURE_TTL_MS;
      }
      cached = catalog;
      expiresAt = now() + ttl;
      return catalog;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
}

export const loadModelCatalog = createModelCatalogLoader();

/** Prefer explicit effort metadata; missing metadata leaves validation to OpenRouter. */
export function getReasoningConfig(modelMetadata, desiredEffort) {
  const reasoning = modelMetadata?.reasoning;
  const hasReasoningMetadata = reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning);
  const parameters = modelMetadata?.supported_parameters;
  if (Array.isArray(parameters) && !parameters.includes('reasoning') && !hasReasoningMetadata) return undefined;

  if (Array.isArray(reasoning?.supported_efforts)) {
    const supported = reasoning.supported_efforts.filter((effort) => EFFORTS.has(effort));
    if (!supported.length) return undefined;
    const effort = supported.includes(desiredEffort) ? desiredEffort : supported[0];
    return { effort, exclude: true };
  }
  return { effort: desiredEffort, exclude: true };
}
