const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_FACTOR = 0.2;

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function getDelay(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_DELAY_MS);
    }
  }

  const exponential = BASE_DELAY_MS * 2 ** attempt;
  const capped = Math.min(exponential, MAX_DELAY_MS);
  const jitter = capped * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, capped + jitter);
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, init);

    if (!isRetryable(response.status) || attempt === MAX_RETRIES) {
      return response;
    }

    lastResponse = response;
    const retryAfter = response.headers.get('retry-after');
    const delay = getDelay(attempt, retryAfter);

    console.warn(
      `[fetchWithRetry] ${response.status} from ${url} — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // Unreachable, but satisfies TypeScript
  return lastResponse!;
}
