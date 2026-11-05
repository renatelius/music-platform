// Small HTTP client for Hugging Face: retries with back-off, byte ranges, optional token.
import { errorMessage, sleep } from './util.js';

const USER_AGENT = 'ReMusic-catalog-import/0.1 (+https://github.com/renatelius/music-platform)';
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HttpOptions {
  /** Hugging Face access token (HF_TOKEN): higher rate limits. Sent only to huggingface.co. */
  readonly token?: string | undefined;
  readonly log: (message: string) => void;
  readonly attempts?: number;
}

export function nextLink(header: string | null): string | null {
  if (header === null) return null;
  const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(header);
  return match?.[1] ?? null;
}

export class HttpClient {
  private downloaded = 0;

  constructor(private readonly options: HttpOptions) {}

  get bytesDownloaded(): number {
    return this.downloaded;
  }

  /** GET a JSON document; `next` is the Link: rel="next" page, if any. */
  json(url: string): Promise<{ body: unknown; next: string | null }> {
    return this.fetchWithRetry(url, {}, 60_000, async (response) => {
      const body: unknown = await response.json();
      return { body, next: nextLink(response.headers.get('link')) };
    });
  }

  /** Bytes [start, end) of a remote file. */
  range(url: string, start: number, end: number): Promise<ArrayBuffer> {
    const length = end - start;
    if (length <= 0) return Promise.resolve(new ArrayBuffer(0));
    // 1 minute plus 20 s per 10 MB: slow connections still finish, stalled ones are retried.
    const timeoutMs = 60_000 + Math.ceil(length / 10_000_000) * 20_000;
    const headers = { range: `bytes=${String(start)}-${String(end - 1)}` };
    return this.fetchWithRetry(url, headers, timeoutMs, async (response) => {
      const data = await response.arrayBuffer();
      if (response.status === 206) {
        if (data.byteLength !== length) {
          throw new Error(`short read: ${String(data.byteLength)} of ${String(length)} bytes`);
        }
        this.downloaded += data.byteLength;
        return data;
      }
      // 200: the server ignored the range and sent the whole file.
      if (data.byteLength < end) throw new Error('response is shorter than the requested range');
      this.downloaded += data.byteLength;
      return data.slice(start, end);
    });
  }

  private authHeaders(url: string): Record<string, string> {
    const token = this.options.token;
    if (token === undefined || token === '') return {};
    return new URL(url).hostname === 'huggingface.co' ? { authorization: `Bearer ${token}` } : {};
  }

  private async fetchWithRetry<T>(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    const attempts = this.options.attempts ?? 5;
    let lastError = new Error(`request failed: ${url}`);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let delayMs = 2000 * 2 ** (attempt - 1);
      let response: Response | undefined;
      try {
        response = await fetch(url, {
          headers: { 'user-agent': USER_AGENT, ...this.authHeaders(url), ...headers },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = new Error(`${errorMessage(error)} (${url})`);
      }
      if (response !== undefined) {
        if (response.ok) {
          try {
            return await read(response);
          } catch (error) {
            lastError = new Error(`${errorMessage(error)} (${url})`);
          }
        } else {
          await response.body?.cancel().catch(() => undefined);
          const status = new HttpError(
            response.status,
            `HTTP ${String(response.status)} ${response.statusText} (${url})`,
          );
          if (!RETRYABLE_STATUS.has(response.status)) throw status;
          lastError = status;
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            delayMs = Math.min(retryAfter * 1000, 120_000);
          }
        }
      }
      if (attempt < attempts) {
        this.options.log(
          `  network: ${lastError.message}; retry ${String(attempt)}/${String(attempts - 1)} in ${String(Math.round(delayMs / 1000))} s`,
        );
        await sleep(delayMs);
      }
    }
    throw lastError;
  }
}
