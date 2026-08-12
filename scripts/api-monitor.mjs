import { rankProbeModels, selectProbeModel } from "./lib/api-model-selection.mjs";

const catalogUrl = process.env.CATALOG_INTERNAL_URL || "http://catalog:8787";
const ingestKey = process.env.API_MONITOR_KEY || "";
const standardIntervalMs = Number(process.env.API_PROBE_INTERVAL_MS || 4 * 60 * 60 * 1000);
const inferenceIntervalMs = Number(process.env.API_INFERENCE_INTERVAL_MS || 24 * 60 * 60 * 1000);
const timeoutMs = Number(process.env.API_PROBE_TIMEOUT_MS || 15000);

const providers = [
  openAiCompatible("doubao-ark", "doubao", process.env.DOUBAO_API_KEY, process.env.DOUBAO_API_BASE || "https://ark.cn-beijing.volces.com/api/v3", process.env.DOUBAO_PROBE_MODEL),
  openAiCompatible("minimax-api", "minimax", process.env.MINIMAX_API_KEY, process.env.MINIMAX_API_BASE || "https://api.minimaxi.com/v1", process.env.MINIMAX_PROBE_MODEL),
  subscriptionConnector(),
  openAiCompatible("openai", "openai", process.env.OPENAI_API_KEY, "https://api.openai.com/v1", process.env.OPENAI_PROBE_MODEL, "responses"),
  perplexityConnector(),
  openAiCompatible("moonshot", "moonshot", process.env.MOONSHOT_API_KEY, "https://api.moonshot.cn/v1", process.env.MOONSHOT_PROBE_MODEL),
  geminiConnector(),
];

function openAiCompatible(id, provider, key, baseUrl, configuredModel, inferenceApi = "chat") {
  let selectedModel = null;
  let candidateModels = [];
  return {
    id, provider, configured: Boolean(key), get model() { return selectedModel || ""; }, get supportsInference() { return Boolean(selectedModel); },
    async standard() {
      if (!key) return unconfigured();
      return requestCheck("models", `${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } }, async (response) => {
        const data = await response.json().catch(() => ({}));
        const models = Array.isArray(data?.data) ? data.data.map((item) => String(item?.id || "")).filter(Boolean) : [];
        candidateModels = rankProbeModels(provider, models, configuredModel);
        selectedModel = candidateModels[0] || null;
        return selectedModel
          ? { model: selectedModel, modelCount: models.length }
          : { status: "degraded", model: null, modelCount: models.length, errorCode: configuredModel ? "probe_model_unavailable" : "no_compatible_model" };
      });
    },
    async inference() {
      if (!key) return unconfigured("inference");
      if (!selectedModel) return skipped("inference", "probe_model_unavailable");
      let lastCheck = skipped("inference", "probe_model_unavailable");
      for (const model of candidateModels.slice(0, 8)) {
        const responsesApi = inferenceApi === "responses";
        const check = await requestCheck("inference", `${baseUrl}/${responsesApi ? "responses" : "chat/completions"}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(responsesApi
            ? { model, input: "ping", max_output_tokens: 16 }
            : { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
        }, () => ({ model }));
        lastCheck = { ...check, model };
        if (check.status === "healthy") { selectedModel = model; return lastCheck; }
        if (check.httpStatus !== 404) return lastCheck;
      }
      return lastCheck;
    },
  };
}

function subscriptionConnector() {
  const key = process.env.MINIMAX_SUBSCRIPTION_KEY;
  return {
    id: "minimax-coding-plan", provider: "minimax", configured: Boolean(key), model: "", supportsInference: false,
    async standard() {
      if (!key) return unconfigured("quota");
      return requestCheck("quota", process.env.MINIMAX_SUBSCRIPTION_URL || "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains", { headers: { Authorization: `Bearer ${key}` } }, async (response) => {
        const data = await response.json().catch(() => ({}));
        const remaining = finite(data?.data?.current_remain ?? data?.current_remain);
        return { quotaSummary: remaining == null ? "available" : `remaining:${Math.max(0, Math.round(remaining))}` };
      });
    },
    async inference() { return skipped("inference", "subscription_credential_not_used_for_inference"); },
  };
}

function perplexityConnector() {
  const key = process.env.PERPLEXITY_API_KEY;
  const model = process.env.PERPLEXITY_PROBE_MODEL || "sonar-pro";
  const url = "https://api.perplexity.ai/v1/sonar";
  const request = (kind) => requestCheck(kind, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1, disable_search: true, messages: [{ role: "user", content: "ping" }] }),
  }, () => ({ model }));
  return {
    id: "perplexity", provider: "perplexity", configured: Boolean(key), model, supportsInference: Boolean(key),
    async standard() { return key ? request("auth") : unconfigured("auth"); },
    async inference() { return key ? request("inference") : unconfigured("inference"); },
  };
}

function geminiConnector() {
  const key = process.env.GEMINI_API_KEY, configuredModel = process.env.GEMINI_PROBE_MODEL || "";
  let selectedModel = null;
  return {
    id: "gemini", provider: "gemini", configured: Boolean(key), get model() { return selectedModel || ""; }, get supportsInference() { return Boolean(selectedModel); },
    async standard() {
      if (!key) return unconfigured();
      return requestCheck("models", "https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": key } }, async (response) => {
        const data = await response.json().catch(() => ({}));
        const models = Array.isArray(data?.models) ? data.models
          .filter((item) => !Array.isArray(item?.supportedGenerationMethods) || item.supportedGenerationMethods.includes("generateContent"))
          .map((item) => String(item?.name || "").replace(/^models\//, "")).filter(Boolean) : [];
        selectedModel = selectProbeModel("gemini", models, configuredModel);
        return selectedModel
          ? { model: selectedModel, modelCount: models.length }
          : { status: "degraded", model: null, modelCount: models.length, errorCode: configuredModel ? "probe_model_unavailable" : "no_compatible_model" };
      });
    },
    async inference() {
      if (!key) return unconfigured("inference");
      if (!selectedModel) return skipped("inference", "probe_model_unavailable");
      return requestCheck("inference", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 } }) }, () => ({ model: selectedModel }));
    },
  };
}

async function requestCheck(kind, url, options, parseSuccess) {
  const started = Date.now(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const base = { kind, status: response.ok ? "healthy" : statusForHttp(response.status), httpStatus: response.status, latencyMs: Date.now() - started };
    return response.ok ? { ...base, ...(await parseSuccess(response)) } : { ...base, errorCode: errorForHttp(response.status) };
  } catch (error) {
    return { kind, status: "down", latencyMs: Date.now() - started, errorCode: error?.name === "AbortError" ? "timeout" : "network_error" };
  } finally { clearTimeout(timer); }
}

function unconfigured(kind = "models") { return { kind, status: "unconfigured", errorCode: "credential_unconfigured" }; }
function skipped(kind, errorCode) { return { kind, status: "unknown", errorCode }; }
function statusForHttp(status) { return status === 429 || status === 402 ? "degraded" : "down"; }
function errorForHttp(status) { return status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 429 ? "rate_limited" : status === 402 ? "insufficient_balance" : status >= 500 ? "provider_5xx" : `http_${status}`; }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }

async function runProvider(connector, mode = "standard") {
  const check = mode === "inference" ? await connector.inference() : await connector.standard();
  const credentialStatus = connector.configured ? (check.httpStatus === 401 || check.httpStatus === 403 ? "error" : "configured") : "unconfigured";
  const overallStatus = check.status;
  const checks = mode === "standard" && ["models", "quota"].includes(check.kind)
    ? [{ ...check, kind: "auth", model: null, modelCount: null, quotaSummary: null }, check]
    : [check];
  const payload = { runId: crypto.randomUUID(), connectorId: connector.id, mode, credentialStatus, overallStatus, observedAt: new Date().toISOString(), checks, errorCode: check.errorCode || null };
  const response = await fetch(`${catalogUrl}/api/ingest/v1/api-provider-probes`, { method: "POST", headers: { Authorization: `Bearer ${ingestKey}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`ingest_${response.status}`);
  return { connector: connector.id, status: overallStatus };
}

async function runCycle(mode = "standard", onlyId = null) {
  if (!ingestKey) throw new Error("api_monitor_key_unconfigured");
  const selected = providers.filter((provider) => (!onlyId || provider.id === onlyId) && (mode !== "inference" || provider.supportsInference));
  const results = await Promise.allSettled(selected.map((provider) => runProvider(provider, mode)));
  const failed = results.filter((result) => result.status === "rejected").length;
  console.log(JSON.stringify({ event: "api_monitor.cycle", mode, providers: selected.length, failed, at: new Date().toISOString() }));
}

async function pollJobs() {
  if (!ingestKey) return;
  const response = await fetch(`${catalogUrl}/api/ingest/v1/api-provider-probes/jobs`, { headers: { Authorization: `Bearer ${ingestKey}` } });
  if (!response.ok) return;
  const body = await response.json().catch(() => ({}));
  for (const job of body.data || []) {
    const claim = await fetch(`${catalogUrl}/api/ingest/v1/api-provider-probes/jobs/${encodeURIComponent(job.id)}/claim`, { method: "POST", headers: { Authorization: `Bearer ${ingestKey}` } });
    if (claim.ok) await runCycle(job.mode === "inference" ? "inference" : "standard", job.connectorId).catch(() => {});
  }
}

async function tick() {
  await pollJobs().catch(() => {});
  await runCycle("standard").catch((error) => console.error(JSON.stringify({ event: "api_monitor.failed", code: String(error?.message || "failed").slice(0, 80) })));
}

await tick();
await runCycle("inference").catch(() => {});
setInterval(() => { tick().catch(() => {}); }, standardIntervalMs);
setInterval(() => { runCycle("inference").catch(() => {}); }, inferenceIntervalMs);
setInterval(() => { pollJobs().catch(() => {}); }, 60_000);
