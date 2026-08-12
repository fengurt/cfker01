const EXCLUDED_MODEL_MARKERS = [
  "audio",
  "embedding",
  "image",
  "moderation",
  "realtime",
  "speech",
  "transcribe",
  "tts",
  "whisper",
];

const PROVIDER_PATTERNS = {
  doubao: [/^doubao/i, /^ep-/i],
  gemini: [/^gemini/i],
  minimax: [/^minimax-(?:m|text)/i],
  moonshot: [/^(?:kimi|moonshot)/i],
  openai: [/^(?:gpt-|o\d)/i],
  perplexity: [/^(?:sonar|pplx)/i],
};

/**
 * Select a current text-generation model from the provider's live model list.
 * An explicit model is accepted only when the provider confirms it exists.
 * Blank, "auto", and "latest" opt into deterministic latest-model selection.
 */
export function selectProbeModel(provider, modelIds, configuredModel = "") {
  return rankProbeModels(provider, modelIds, configuredModel)[0] || null;
}

export function rankProbeModels(provider, modelIds, configuredModel = "") {
  const models = [...new Set((modelIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const requested = String(configuredModel || "").trim();
  if (requested && !["auto", "latest"].includes(requested.toLowerCase())) {
    return models.includes(requested) ? [requested] : [];
  }

  const patterns = PROVIDER_PATTERNS[provider] || [];
  const candidates = models.filter((model) => {
    const lower = model.toLowerCase();
    return !EXCLUDED_MODEL_MARKERS.some((marker) => lower.includes(marker))
      && (provider !== "doubao" || /^doubao-seed-\d+-\d+-(?:(?:pro|turbo|lite|mini)-)?\d+$/i.test(model))
      && (provider !== "openai" || /^(?:gpt-\d+(?:\.\d+)?(?:-\d{4}-\d{2}-\d{2}|-pro|-mini|-nano)?|o\d(?:-mini|-pro)?)$/i.test(model))
      && (patterns.length === 0 || patterns.some((pattern) => pattern.test(model)));
  });
  return candidates.sort((left, right) => compareModels(provider, right, left));
}

function compareModels(provider, left, right) {
  const leftScore = modelScore(provider, left);
  const rightScore = modelScore(provider, right);
  for (let index = 0; index < Math.max(leftScore.length, rightScore.length); index += 1) {
    const difference = (leftScore[index] || 0) - (rightScore[index] || 0);
    if (difference) return difference;
  }
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function modelScore(provider, model) {
  const lower = model.toLowerCase();
  const bareOpenAi = provider === "openai" && /^gpt-\d+(?:\.\d+)?$/.test(lower);
  const providerFamily = bareOpenAi ? 6
    : provider === "doubao" && lower.includes("-pro-") ? 5
    : provider === "perplexity" && lower.includes("sonar-pro") ? 5
      : provider === "moonshot" && lower.startsWith("kimi") ? 5
      : lower.includes("pro") ? 4
        : lower.includes("flash") || lower.includes("mini") || lower.includes("lite") ? 2
          : 3;
  const stable = /preview|experimental|exp/.test(lower) ? 0 : 1;
  const latestAlias = lower.includes("latest") ? 1 : 0;
  const date = Math.max(0, ...(lower.match(/(?:20)?\d{6,8}/g) || []).map((value) => Number(value)));
  const versions = [...lower.matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite)
    .slice(0, 4);
  if (provider === "doubao") return [versions[0] || 0, versions[1] || 0, providerFamily, date, latestAlias, stable];
  if (["moonshot", "perplexity"].includes(provider)) return [providerFamily, versions[0] || 0, versions[1] || 0, date, latestAlias, stable];
  return [versions[0] || 0, providerFamily, date, latestAlias, stable];
}
