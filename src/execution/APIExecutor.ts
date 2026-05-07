export interface APICallParams {
  method:         string;
  url:            string;
  headers?:       Record<string, string>;
  body?:          unknown;
  assert_status?: number;
  timeout_ms?:    number;
}

export interface APICallResult {
  status:      number;
  data:        unknown;
  duration_ms: number;
}

import { AssertionError, TransientError } from "../errors";

export class APIExecutor {
  async call(params: APICallParams): Promise<APICallResult> {
    const start      = Date.now();
    const controller = new AbortController();
    const timer      = setTimeout(
      () => controller.abort(),
      params.timeout_ms ?? 15_000
    );

    try {
      const hasBody = params.body != null;
      const res = await fetch(params.url, {
        method:  params.method.toUpperCase(),
        headers: {
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...params.headers,
        },
        body:   hasBody ? JSON.stringify(params.body) : undefined,
        signal: controller.signal,
      });

      const data = await res.json().catch(() => null);

      if (params.assert_status != null && res.status !== params.assert_status) {
        throw new AssertionError(`Expected HTTP ${params.assert_status}, got ${res.status}`);
      }

      return { status: res.status, data, duration_ms: Date.now() - start };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new TransientError(`API call timed out after ${params.timeout_ms ?? 15_000}ms: ${params.url}`);
      }
      throw new TransientError((err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}
