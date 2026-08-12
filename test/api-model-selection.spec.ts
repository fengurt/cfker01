import { describe, expect, it } from "vitest";
import { rankProbeModels, selectProbeModel } from "../scripts/lib/api-model-selection.mjs";

describe("API probe model selection", () => {
  it("uses an explicit model only when it is currently available", () => {
    expect(selectProbeModel("openai", ["gpt-5.2", "gpt-5.4"], "gpt-5.2")).toBe("gpt-5.2");
    expect(selectProbeModel("openai", ["gpt-5.4"], "gpt-5.2")).toBeNull();
  });

  it("selects the latest compatible text model and excludes non-chat models", () => {
    expect(selectProbeModel("openai", ["text-embedding-4", "gpt-5.2", "gpt-5.4", "gpt-image-2"])).toBe("gpt-5.4");
    expect(selectProbeModel("minimax", ["MiniMax-M2.1", "MiniMax-M2.5", "speech-2.6"])).toBe("MiniMax-M2.5");
    expect(selectProbeModel("moonshot", ["moonshot-v1-128k", "kimi-k2.5"])).toBe("kimi-k2.5");
  });

  it("prefers provider production families and stable aliases", () => {
    expect(selectProbeModel("perplexity", ["sonar", "sonar-pro", "sonar-reasoning"])).toBe("sonar-pro");
    expect(selectProbeModel("doubao", ["doubao-pro-32k-240515", "doubao-seed-1-6-251015"])).toBe("doubao-seed-1-6-251015");
    expect(selectProbeModel("gemini", ["embedding-001", "gemini-2.5-pro", "gemini-3-pro-preview"])).toBe("gemini-3-pro-preview");
  });

  it("avoids specialized catalog entries that are not general inference models", () => {
    expect(selectProbeModel("doubao", ["doubao-seed-character-260628", "doubao-seedream-5-0-pro-260628", "doubao-seed-2-1-pro-260628"])).toBe("doubao-seed-2-1-pro-260628");
    expect(selectProbeModel("openai", ["gpt-5.3-chat-latest", "gpt-5.5", "gpt-5.6-terra", "gpt-5.5-pro"])).toBe("gpt-5.5");
  });

  it("keeps ordered fallbacks so a catalog-only model does not block probing", () => {
    expect(rankProbeModels("doubao", [
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-1-turbo-260628",
      "doubao-seed-2-1-pro-260628",
    ])).toEqual([
      "doubao-seed-2-1-pro-260628",
      "doubao-seed-2-1-turbo-260628",
      "doubao-seed-2-0-pro-260215",
    ]);
  });
});
