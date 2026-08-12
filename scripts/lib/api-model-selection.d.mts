export function selectProbeModel(
  provider: string,
  modelIds: unknown[],
  configuredModel?: string,
): string | null;

export function rankProbeModels(
  provider: string,
  modelIds: unknown[],
  configuredModel?: string,
): string[];
