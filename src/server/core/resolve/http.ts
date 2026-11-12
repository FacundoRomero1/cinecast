import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const CHROME_MAJOR = '131';
export const RESOLVE_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'HEAD' | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | Buffer | undefined;
  requiresReferer?: boolean | undefined;
  tlsLax?: boolean | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
  retries?: number | undefined;
  bareHeaders?: boolean | undefined;
}

export interface HttpResponseData {
  url: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  redirectLocation: string | null;
  body: string;
  bytes: number;
  truncated: boolean;
  attempts: number;
}

export interface HttpRedirectResponseData extends HttpResponseData {
  finalUrl: string;
}

export function buildBrowserHeaders(
  urlString: string,
  options: { requiresReferer?: boolean | undefined; extraHeaders?: Record<string, string> | undefined; bareHeaders?: boolean | undefined } = {}
): Record<string, string> {
  if (options.bareHeaders) {
    return { ...(options.extraHeaders || {}) };
  }

  const headers: Record<string, string> = {
    'User-Agent': RESOLVE_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };

  if (options.requiresReferer) {
    try {
      const urlObj = new URL(urlString);
      headers['Referer'] = `${urlObj.protocol}//${urlObj.hostname}/`;
      headers['Origin'] = `${urlObj.protocol}//${urlObj.hostname}`;
      headers['Sec-Fetch-Site'] = 'same-origin';
    } catch {
      // ignore invalid URL
    }
  }

  if (options.extraHeaders) {
    for (const [k, v] of Object.entries(options.extraHeaders)) {
      headers[k] = v;
    }
  }

  return headers;
}

function decompressBody(
  buffer: Buffer,
  contentEncoding: string | string[] | undefined,
  truncated: boolean
): string {
  if (truncated || buffer.length === 0) {
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  }
  const enc = String(
    Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding || ''
  ).toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer).toString('utf8').replace(/^\uFEFF/, '');
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer).toString('utf8').replace(/^\uFEFF/, '');
    if (enc.includes('deflate')) return zlib.inflateSync(buffer).toString('utf8').replace(/^\uFEFF/, '');
  } catch {
    // fallback raw utf8
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function singleAttemptRequest(
  urlString: string,
  options: HttpRequestOptions
): Promise<Omit<HttpResponseData, 'attempts'>> {
  return new Promise((resolvePromise, rejectPromise) => {
    let urlObj: URL;
    try {
      urlObj = new URL(urlString);
    } catch (err) {
      rejectPromise(err);
      return;
    }

    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;
    const agent =
      isHttps && options.tlsLax ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    const headers = buildBrowserHeaders(urlString, {
      requiresReferer: options.requiresReferer,
      extraHeaders: options.headers,
      bareHeaders: options.bareHeaders,
    });
    const timeoutMs = Math.max(250, options.timeoutMs ?? 12_000);
    const method = options.method || 'GET';

    let settled = false;
    let req: http.ClientRequest | null = null;

    const finish = <T>(fn: (v: T) => void, val: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (agent) {
        try {
          agent.destroy();
        } catch {
          // ignore
        }
      }
      fn(val);
    };

    const timer = setTimeout(() => {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
      (timeoutErr as Error & { code?: string }).code = 'TIMEOUT_ERR';
      if (req) {
        try {
          req.destroy(timeoutErr);
        } catch {
          // ignore
        }
      }
      finish(rejectPromise, timeoutErr);
    }, timeoutMs);

    req = transport.request(
      urlObj,
      {
        method,
        family: 4,
        headers,
        agent,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers?.location;

        if (status >= 300 && status < 400 && location) {
          res.resume();
          finish(resolvePromise, {
            url: urlString,
            status,
            headers: res.headers,
            redirectLocation: new URL(location, urlString).toString(),
            body: '',
            bytes: 0,
            truncated: false,
          });
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const maxBytes = options.maxBytes;
        let truncated = false;

        const finalizeBody = () => {
          const buf = Buffer.concat(chunks);
          const body = decompressBody(buf, res.headers?.['content-encoding'], truncated);
          finish(resolvePromise, {
            url: urlString,
            status,
            headers: res.headers,
            redirectLocation: null,
            body,
            bytes: buf.length,
            truncated,
          });
        };

        res.on('data', (chunk: Buffer) => {
          if (typeof maxBytes === 'number' && maxBytes > 0) {
            const remaining = maxBytes - totalBytes;
            if (remaining > 0) {
              const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
              chunks.push(slice);
              totalBytes += slice.length;
            }
            if (totalBytes >= maxBytes && !truncated) {
              truncated = true;
              res.destroy();
            }
            return;
          }
          chunks.push(chunk);
          totalBytes += chunk.length;
        });

        res.on('end', finalizeBody);
        res.on('close', () => {
          if (truncated) finalizeBody();
        });
        res.on('error', (err) => {
          if (truncated) {
            finalizeBody();
            return;
          }
          finish(rejectPromise, err);
        });
      }
    );

    req.on('error', (err) => {
      if (settled) return;
      finish(rejectPromise, err);
    });

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Ejecuta una petición HTTP/HTTPS con IPv4 (`family: 4`), timeout por request
 * y un reintento automático en error de red/timeout.
 */
export async function httpRequest(
  urlString: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponseData> {
  const maxRetries = Math.max(0, options.retries ?? 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 1 + maxRetries; attempt += 1) {
    try {
      const res = await singleAttemptRequest(urlString, options);
      return { ...res, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt <= maxRetries) {
        await sleep(150);
      }
    }
  }

  throw lastError;
}

export async function httpRequestFollowingRedirects(
  urlString: string,
  options: HttpRequestOptions & { maxRedirects?: number | undefined } = {}
): Promise<HttpRedirectResponseData> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = urlString;
  let totalAttempts = 0;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const res = await httpRequest(currentUrl, options);
    totalAttempts += res.attempts;
    if (res.redirectLocation && hop < maxRedirects) {
      currentUrl = res.redirectLocation;
      continue;
    }
    return {
      ...res,
      finalUrl: currentUrl,
      attempts: totalAttempts,
    };
  }

  throw new Error(`Too many redirects (>${maxRedirects})`);
}

export async function httpPostForm(
  urlString: string,
  fields: Record<string, string>,
  options: Omit<HttpRequestOptions, 'method' | 'body'> = {}
): Promise<HttpRedirectResponseData> {
  const body = new URLSearchParams(fields).toString();
  return httpRequestFollowingRedirects(urlString, {
    ...options,
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
      ...(options.headers || {}),
    },
  });
}

export async function httpGetFirstBytes(
  urlString: string,
  maxBytes = 512,
  options: Omit<HttpRequestOptions, 'method' | 'maxBytes'> = {}
): Promise<HttpRedirectResponseData> {
  return httpRequestFollowingRedirects(urlString, {
    ...options,
    method: 'GET',
    maxBytes,
    headers: {
      'Accept-Encoding': 'identity',
      ...(options.headers || {}),
    },
  });
}

