import type { Collector, SourceConfig } from "./types";
import { collectCloudflare } from "./cloudflare";
import { collectTencent } from "./tencent";
import { collectOpenai } from "./openai";
import { collectMinimax } from "./minimax";

const COLLECTORS: Record<SourceConfig["kind"], Collector> = {
  cloudflare: collectCloudflare,
  tencent: collectTencent,
  openai: collectOpenai,
  minimax: collectMinimax,
};

export const DEFAULT_SOURCES: SourceConfig[] = [
  { id: "cloudflare", label: "Cloudflare", kind: "cloudflare" },
  { id: "tencent", label: "Tencent Cloud", kind: "tencent", region: "ap-guangzhou" },
  { id: "openai", label: "ChatGPT / Codex", kind: "openai" },
  { id: "minimax", label: "MiniMax", kind: "minimax" },
];

export function getCollector(kind: SourceConfig["kind"]): Collector | null {
  return COLLECTORS[kind] ?? null;
}

export function listSources(): SourceConfig[] {
  return DEFAULT_SOURCES;
}