export type SmokeFetchOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<unknown>;
};

export function fetchWithNetworkRetry<T>(
  fetchImpl: (input: unknown, init?: unknown) => Promise<T>,
  input: unknown,
  init?: unknown,
  options?: SmokeFetchOptions,
): Promise<T>;
