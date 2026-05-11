export interface RunMeta {
  runId:       string;
  type:        string;
  status:      "queued" | "running" | "passed" | "failed" | "error" | "cancelled";
  startedAt:   string | null;
  completedAt: string | null;
  summary?:    { passed: number; failed: number; total: number; score: number; grade: string };
  error?:      string;
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

export const api = {
  runs: {
    list: ()                        => apiFetch<RunMeta[]>("/api/runs"),
    get:  (id: string)              => apiFetch<RunMeta>(`/api/runs/${id}`),
    results: (id: string)           => apiFetch<RunResult[]>(`/api/runs/${id}/results`),
    reportUrl: (id: string)         => `/api/runs/${id}/report`,
    cancel: (id: string)            => apiFetch<void>(`/api/runs/${id}/cancel`, { method: "POST" }),
  },
  trigger: {
    run: (yaml: string, opts?: { headless?: boolean }) =>
      apiFetch<{ runId: string }>("/api/run", { method: "POST", body: JSON.stringify({ content: yaml, ...opts }) }),
    orchestrate: (url: string, opts?: { maxPages?: number; headless?: boolean; dryRun?: boolean }) =>
      apiFetch<{ runId: string }>("/api/orchestrate", { method: "POST", body: JSON.stringify({ url, ...opts }) }),
  },
  tests: {
    read:  (filePath: string)               => apiFetch<{ content: string }>(`/api/tests/${filePath}`),
    write: (filePath: string, content: string) =>
      apiFetch<void>(`/api/tests/${filePath}`, { method: "PUT", body: JSON.stringify({ content }) }),
  },
};

export function openRunStream(runId: string, onEvent: (e: Record<string, unknown>) => void): () => void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const key   = getApiKey();
  const url   = `${proto}//${location.host}/api/runs/${runId}/stream${key ? `?token=${encodeURIComponent(key)}` : ""}`;
  const ws    = new WebSocket(url);
  ws.onmessage = (msg) => {
    try { onEvent(JSON.parse(msg.data) as Record<string, unknown>); } catch { /* ignore */ }
  };
  return () => ws.close();
}
