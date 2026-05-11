import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, RunMeta, RunResult, StepResult, openRunStream } from "../api";
import StatusBadge from "../components/StatusBadge";

interface LogLine { text: string; kind: "log" | "pass" | "fail" | "info" }

function humanizeError(raw: string): string {
  if (/could not resolve locator/i.test(raw)) {
    const m = raw.match(/for[:\s]+"?([^"]+)"?/i);
    return `Could not find "${m?.[1] ?? "element"}" on the page`;
  }
  if (/timeout \d+ms exceeded/i.test(raw)) return "Page took too long to respond";
  if (/net::ERR_|navigation failed/i.test(raw)) return "Could not load the page — check if the URL is reachable";
  if (/assertTextVisible|text.*not found/i.test(raw)) {
    const m = raw.match(/text "([^"]+)"/i);
    return `Expected text "${m?.[1] ?? "..."}" was not found on the page`;
  }
  return raw;
}

function screenshotUrl(runId: string, p: string): string {
  return `/api/runs/${runId}/screenshots/${p.split("/").pop()}`;
}

const GRADE_LEGEND = "A: 90–100 · B: 75–89 · C: 60–74 · D: 50–59 · F: 0–49";

export default function RunDetail() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const [meta, setMeta]         = useState<RunMeta | null>(null);
  const [results, setResults]   = useState<RunResult[]>([]);
  const [logs, setLogs]         = useState<LogLine[]>([]);
  const [tab, setTab]           = useState<"log" | "results" | "report">("log");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [logPaused, setLogPaused]   = useState(false);
  const [logFilter, setLogFilter]   = useState("");
  const [wsDisconnected, setWsDisconnected] = useState(false);
  const logRef                  = useRef<HTMLDivElement>(null);
  const closeWs                 = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!id) return;

    api.runs.get(id)
      .then(m => {
        setMeta(m);
        if (m.status === "passed" || m.status === "failed") {
          return api.runs.results(id).then(r => {
            if (Array.isArray(r)) setResults(r as RunResult[]);
          });
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    closeWs.current = openRunStream(id, (e) => {
      const event = e.event as string;
      const addLog = (text: string, kind: LogLine["kind"]) =>
        setLogs(prev => [...prev, { text, kind }]);

      if (event === "done") {
        const s = e.summary as { passed?: number; failed?: number; total?: number; score?: number; grade?: string } | undefined;
        const status = (e.status as string) ?? "unknown";
        const passed = status === "passed";
        let text = passed ? "✓ Run complete" : "✗ Run complete";
        if (s) {
          text += ` — ${s.passed ?? 0} passed, ${s.failed ?? 0} failed`;
          if (s.score !== undefined) text += ` · Score: ${s.score}/100 (${s.grade})`;
        }
        addLog(text, passed ? "pass" : "fail");
        api.runs.get(id).then(setMeta).catch(() => {});
        api.runs.results(id).then(r => {
          if (Array.isArray(r)) setResults(r as RunResult[]);
        }).catch(() => {});
        setTab("results");
        return;
      }

      if (event === "step") {
        const target = e.target as string | undefined;
        addLog(`[${(e.index as number) + 1}] ${e.action as string}${target ? ` → ${target}` : ""}`, "log");
        return;
      }

      if (event === "step_result") {
        const passed = e.passed as boolean;
        const dur    = e.durationMs as number;
        const err    = e.error as string | undefined;
        const ssUrl  = e.screenshotUrl as string | undefined;
        if (passed) {
          addLog(`  ✓ done (${dur}ms)`, "pass");
        } else {
          addLog(`  ✗ ${err ?? "failed"} (${dur}ms)`, "fail");
          if (ssUrl) addLog(`  📸 ${ssUrl}`, "info");
        }
        return;
      }

      if (event === "test_done") {
        const passed = e.passed as boolean;
        addLog(`── ${passed ? "✓ PASSED" : "✗ FAILED"}: ${e.testName as string} (${e.durationMs as number}ms)`, passed ? "pass" : "fail");
        return;
      }

      if (event === "error") {
        addLog(`ERROR: ${e.message as string ?? "unknown error"}`, "fail");
        return;
      }

      const msg = (e.message ?? e.label ?? "") as string;
      if (!msg) return;
      addLog(msg, event === "info" ? "info" : "log");
    }, () => setWsDisconnected(true));

    return () => { closeWs.current?.(); };
  }, [id]);

  // Auto-scroll log when not paused
  useEffect(() => {
    if (!logPaused && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, logPaused]);

  // Auto-expand failed tests
  useEffect(() => {
    if (results.length > 0) {
      const failed = new Set(
        results.map((r, i) => (!r.passed ? i : -1)).filter(i => i !== -1)
      );
      setExpanded(failed);
    }
  }, [results]);

  if (!id) return null;

  const reportUrl       = api.runs.reportUrl(id);
  const effectiveStatus: RunMeta["status"] =
    (meta?.summary?.failed ?? 0) > 0 ? "failed" : (meta?.status ?? "queued");

  const toggleRow = (i: number) =>
    setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const cancelRun = () => {
    if (!window.confirm("Cancel this run? This cannot be undone.")) return;
    api.runs.cancel(id).catch(() => {});
  };

  const rerun = async () => {
    if (!meta) return;
    try {
      let runId: string;
      if (meta.type === "orchestrate" && meta.config?.url) {
        ({ runId } = await api.trigger.orchestrate(meta.config.url, { headless: true }));
      } else if (meta.type === "run-all" && meta.config?.dir) {
        ({ runId } = await api.trigger.runAll(meta.config.dir, { headless: true }));
      } else return;
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const downloadCsv = () => {
    const rows = [
      ["Test", "Status", "Duration (ms)", "Error"],
      ...results.map(r => [
        r.testName,
        r.passed ? "PASSED" : "FAILED",
        String(r.durationMs),
        r.error ?? "",
      ]),
    ];
    const csv  = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `aiqa-results-${id?.slice(0, 8)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const visibleLogs = logFilter
    ? logs.filter(l => l.text.toLowerCase().includes(logFilter.toLowerCase()))
    : logs;

  const canRerun = (meta?.type === "orchestrate" && !!meta.config?.url) ||
                   (meta?.type === "run-all" && !!meta.config?.dir);

  const tabs: { key: "log" | "results" | "report"; label: string }[] = [
    { key: "log",     label: "Live Log" },
    { key: "results", label: `Results${results.length > 0 ? ` (${results.length})` : ""}` },
    ...(meta?.type === "orchestrate" ? [{ key: "report" as const, label: "HTML Report" }] : []),
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={() => navigate("/runs")} style={{ background: "none", border: "none", color: "#6366f1", fontSize: 20, cursor: "pointer" }}>←</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>Run Detail</h1>
          <code style={{ fontSize: 11, color: "#64748b" }}>{id}</code>
        </div>
        {meta && <StatusBadge status={effectiveStatus} />}
        {canRerun && (
          <button onClick={rerun} style={secondaryActionBtn}>↺ Re-run</button>
        )}
        {meta?.status === "running" && (
          <button onClick={cancelRun} style={dangerBtn}>Cancel</button>
        )}
      </div>

      {error && <div style={errStyle}>{error}</div>}
      {loading && <div style={{ color: "#64748b" }}>Loading...</div>}

      {/* Failure banner */}
      {meta?.summary && meta.summary.failed > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
          padding: "12px 16px", marginBottom: 16,
        }}>
          <span style={{ fontSize: 18 }}>✗</span>
          <div>
            <div style={{ fontWeight: 700, color: "#dc2626", fontSize: 14 }}>
              {meta.summary.failed} test{meta.summary.failed > 1 ? "s" : ""} failed
            </div>
            <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>
              {meta.summary.passed} of {meta.summary.total} passed
              {meta.summary.score !== undefined ? ` · Readiness score: ${meta.summary.score}/100 (${meta.summary.grade})` : ""}
              {" "}— expand a failed row in Results to see step details and screenshots
            </div>
          </div>
        </div>
      )}

      {/* Meta cards */}
      {meta && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {[
            { label: "Type",     value: meta.type, color: "", tip: "" },
            { label: "Started",  value: meta.startedAt ? new Date(meta.startedAt).toLocaleString() : "—", color: "", tip: "" },
            { label: "Ended",    value: meta.completedAt ? new Date(meta.completedAt).toLocaleString() : "—", color: "", tip: "" },
            ...(meta.startedAt && meta.completedAt ? [{
              label: "Duration",
              value: `${((new Date(meta.completedAt).getTime() - new Date(meta.startedAt).getTime()) / 1000).toFixed(1)}s`,
              color: "", tip: "",
            }] : []),
            ...(meta.summary ? [
              { label: "Passed",
                value: `${meta.summary.passed} / ${meta.summary.total}`,
                color: meta.summary.failed > 0 ? "#dc2626" : "#16a34a",
                tip: "" },
              ...(meta.summary.score !== undefined ? [
                { label: "Score",
                  value: `${meta.summary.score}/100 (${meta.summary.grade})`,
                  color: meta.summary.score >= 75 ? "#16a34a" : meta.summary.score >= 50 ? "#d97706" : "#dc2626",
                  tip: GRADE_LEGEND },
              ] : []),
            ] : []),
          ].map(c => (
            <div key={c.label} title={c.tip || undefined}
              style={{ background: "#fff", borderRadius: 10, padding: "12px 18px", border: "1px solid #e2e8f0",
                cursor: c.tip ? "help" : undefined }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.color || undefined }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 18px", borderRadius: "8px 8px 0 0",
            border: "1px solid #e2e8f0", borderBottom: tab === t.key ? "none" : "1px solid #e2e8f0",
            background: tab === t.key ? "#fff" : "#f8fafc",
            color: tab === t.key ? "#6366f1" : "#64748b",
            fontWeight: tab === t.key ? 600 : 400, fontSize: 13, cursor: "pointer",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Live Log tab ── */}
      {tab === "log" && (
        <div style={{ background: "#fff", borderRadius: "0 8px 8px 8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {wsDisconnected && (
            <div style={{ background: "#fef9c3", color: "#854d0e", padding: "6px 12px", fontSize: 12, borderBottom: "1px solid #fde047" }}>
              ⚠ Live stream disconnected — refresh the page to reconnect
            </div>
          )}
          {/* Log toolbar */}
          <div style={{ display: "flex", gap: 8, padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <input
              placeholder="Filter log…"
              value={logFilter}
              onChange={e => setLogFilter(e.target.value)}
              style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12, outline: "none" }}
            />
            <button
              onClick={() => setLogPaused(p => !p)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
                background: logPaused ? "#fef9c3" : "#fff", fontSize: 12, cursor: "pointer" }}
            >
              {logPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
          </div>
          {/* Log stream */}
          <div ref={logRef} style={{
            fontFamily: "monospace", fontSize: 12, padding: 16,
            height: 380, overflowY: "auto", background: "#0f172a",
          }}>
            {visibleLogs.length === 0 && (
              <span style={{ color: "#475569" }}>
                {logFilter ? "No matching log lines" : "Waiting for events…"}
              </span>
            )}
            {visibleLogs.map((l, i) => (
              <div key={i} style={{
                color: l.kind === "pass" ? "#4ade80" : l.kind === "fail" ? "#f87171" : "#94a3b8",
                marginBottom: 2,
              }}>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results tab ── */}
      {tab === "results" && (
        <div style={{ background: "#fff", borderRadius: "0 8px 8px 8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {results.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
              {meta?.status === "running" ? "Run in progress — results appear when complete." : "No results yet."}
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              {/* Results toolbar */}
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  Test Results
                  <span style={{ fontWeight: 400, fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>
                    click a row to expand steps
                  </span>
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={downloadCsv} style={csvBtn}>↓ CSV</button>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ ...thStyle, width: 20 }} />
                    {["Test", "Status", "Duration", "Error"].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <React.Fragment key={i}>
                      <tr
                        onClick={() => toggleRow(i)}
                        style={{
                          borderBottom: expanded.has(i) ? "none" : "1px solid #f1f5f9",
                          cursor: "pointer",
                          background: !r.passed ? "#fff8f8" : undefined,
                        }}
                      >
                        <td style={{ ...tdStyle, color: "#94a3b8", fontSize: 11, userSelect: "none" }}>
                          {expanded.has(i) ? "▾" : "▸"}
                        </td>
                        <td style={tdStyle}>{r.testName}</td>
                        <td style={tdStyle}><StatusBadge status={r.passed ? "passed" : "failed"} /></td>
                        <td style={tdStyle}>{r.durationMs}ms</td>
                        <td style={{ ...tdStyle, color: "#dc2626", fontFamily: "monospace", fontSize: 11 }}>
                          {r.error ? humanizeError(r.error) : ""}
                        </td>
                      </tr>

                      {/* Step rows */}
                      {expanded.has(i) && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0, borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ borderLeft: "3px solid #e2e8f0", marginLeft: 20 }}>
                              {(r.stepResults ?? []).map((s: StepResult, si: number) => (
                                <div key={si} style={{
                                  display: "flex", alignItems: "flex-start", gap: 10,
                                  padding: "7px 16px 7px 12px",
                                  background: s.passed ? "#f0fdf4" : "#fff1f2",
                                  borderBottom: si < (r.stepResults?.length ?? 0) - 1 ? "1px solid #f1f5f9" : "none",
                                }}>
                                  <span style={{ color: s.passed ? "#16a34a" : "#dc2626", fontWeight: 700, fontSize: 13, minWidth: 14, paddingTop: 1 }}>
                                    {s.passed ? "✓" : "✗"}
                                  </span>
                                  <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 22, paddingTop: 2 }}>{s.index + 1}.</span>
                                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "#334155", minWidth: 90 }}>{s.action}</span>
                                  <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 52, paddingTop: 2 }}>{s.durationMs}ms</span>
                                  {s.error && (
                                    <span style={{ fontSize: 11, color: "#dc2626", flex: 1, paddingTop: 2 }}>
                                      {humanizeError(s.error)}
                                    </span>
                                  )}
                                  {s.screenshotPath && (
                                    <a href={screenshotUrl(id, s.screenshotPath)} target="_blank" rel="noreferrer"
                                      onClick={ev => ev.stopPropagation()} title="Open screenshot">
                                      <img src={screenshotUrl(id, s.screenshotPath)} alt="failure screenshot"
                                        style={{ height: 56, width: "auto", borderRadius: 4,
                                          border: "1px solid #fecaca", display: "block" }} />
                                    </a>
                                  )}
                                </div>
                              ))}
                              {(!r.stepResults || r.stepResults.length === 0) && (
                                <div style={{ padding: "8px 12px", fontSize: 11, color: "#94a3b8" }}>
                                  No step details available
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── HTML Report tab ── */}
      {tab === "report" && (
        <iframe
          src={reportUrl}
          style={{ width: "100%", height: "calc(100vh - 260px)", border: "1px solid #e2e8f0",
            borderRadius: "0 8px 8px 8px", background: "#fff" }}
          title="AIQA HTML Report"
        />
      )}
    </div>
  );
}

const thStyle: React.CSSProperties        = { padding: "8px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b" };
const tdStyle: React.CSSProperties        = { padding: "10px 16px", fontSize: 12 };
const errStyle: React.CSSProperties       = { background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 };
const dangerBtn: React.CSSProperties      = { padding: "6px 14px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", fontSize: 12, cursor: "pointer" };
const secondaryActionBtn: React.CSSProperties = { padding: "6px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, cursor: "pointer" };
const csvBtn: React.CSSProperties         = { padding: "5px 12px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, cursor: "pointer" };
