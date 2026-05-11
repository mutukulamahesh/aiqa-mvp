export interface RunMeta {
  runId:       string;
  type:        string;
  status:      "queued" | "running" | "passed" | "failed" | "error" | "cancelled";
  startedAt:   string | null;
  completedAt: string | null;
  summary?:    { passed: number; failed: number; total: number; score: number; grade: string };
  error?:      string;
  config?:     { url?: string; dir?: string; envKeys?: string[] };
}

export interface StepResult {
  index:           number;
  action:          string;
  passed:          boolean;
  durationMs:      number;
  error?:          string;
  screenshotPath?: string;
}

export interface RunResult {
  testName:     string;
  passed:       boolean;
  durationMs:   number;
  error?:       string;
  tags?:        string[];
  stepResults?: StepResult[];
}

export interface TestFile {
  name: string;
  path: string;
}

const KEY_STORAGE = "aiqa:apiKey";

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? "";
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

function headers(): Record<string, string> {
  const key = getApiKey();
  return key ? { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...opts, headers: { ...headers(), ...(opts?.headers ?? {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

async function apiFetchText(path: string): Promise<string> {
  const key = getApiKey();
  const h: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  const res = await fetch(path, { headers: h });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return res.text();
}

async function apiFetchVoid(path: string, opts: RequestInit): Promise<void> {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
}

export const api = {
  runs: {
    list: (limit = 20)              => apiFetch<RunMeta[]>(`/api/runs?limit=${limit}`),
    get:  (id: string)              => apiFetch<RunMeta>(`/api/runs/${id}`),
    results: (id: string)           => apiFetch<unknown>(`/api/runs/${id}/results`),
    reportUrl: (id: string)         => `/api/runs/${id}/report`,
    cancel: (id: string)            => apiFetch<void>(`/api/runs/${id}/cancel`, { method: "POST" }),
  },
  trigger: {
    run: (yaml: string, opts?: { headless?: boolean; vars?: Record<string, string> }) =>
      apiFetch<{ runId: string }>("/api/run", { method: "POST", body: JSON.stringify({ content: yaml, ...opts }) }),
    runAll: (dir: string, opts?: { headless?: boolean; workers?: number; vars?: Record<string, string> }) =>
      apiFetch<{ runId: string }>("/api/run-all", { method: "POST", body: JSON.stringify({ dir, ...opts }) }),
    orchestrate: (url: string, opts?: { maxPages?: number; headless?: boolean; vars?: Record<string, string> }) =>
      apiFetch<{ runId: string }>("/api/orchestrate", { method: "POST", body: JSON.stringify({ url, ...opts }) }),
  },
  tests: {
    list:  (dir?: string) => apiFetch<TestFile[]>(`/api/tests${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`),
    read:  (filePath: string) => apiFetchText(`/api/tests/${filePath}`),
    write: (filePath: string, content: string) => {
      const key = getApiKey();
      const h: Record<string, string> = { "Content-Type": "text/yaml", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
      return apiFetchVoid(`/api/tests/${filePath}`, { method: "PUT", headers: h, body: content });
    },
  },
};

export function openRunStream(
  runId: string,
  onEvent: (e: Record<string, unknown>) => void,
  onDisconnect?: () => void,
): () => void {
  let ws: WebSocket;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const key   = getApiKey();
    const url   = `${proto}//${location.host}/api/runs/${runId}/stream${key ? `?token=${encodeURIComponent(key)}` : ""}`;
    ws = new WebSocket(url);
    ws.onmessage = (msg) => {
      try { onEvent(JSON.parse(msg.data) as Record<string, unknown>); } catch { /* ignore */ }
    };
    ws.onerror = () => { /* handled by onclose */ };
    ws.onclose = (ev) => {
      if (stopped) return;
      if (!ev.wasClean) {
        // Unexpected drop (proxy timeout etc.) — clear buffered log and reconnect
        onEvent({ event: "_reconnect" });
        retryTimer = setTimeout(connect, 2500);
      } else {
        onDisconnect?.();
      }
    };
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}
