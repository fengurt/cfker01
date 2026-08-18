export async function fetchWithNetworkRetry(
  fetchImpl,
  input,
  init,
  { attempts = 3, delayMs = 750, sleep = defaultSleep } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
