import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, RunMeta, RunResult, StepResult, openRunStream } from "../api";
import StatusBadge from "../components/StatusBadge";

interface LogLine { text: string; kind: "log" | "pass" | "fail" | "info" }

function humanizeError(raw: string): string {
  if (/could not resolve locator/i.test(raw) || /locator_failure/i.test(raw)) {
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

export default function RunDetail() {
  const { id }        = useParams<{ id: string }>();
  const navigate      = useNavigate();
  const [meta, setMeta]         = useState<RunMeta | null>(null);
  const [results, setResults]   = useState<RunResult[]>([]);
  const [logs, setLogs]         = useState<LogLine[]>([]);
  const [tab, setTab]           = useState<"live" | "report">("live");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const logRef                  = useRef<HTMLDivElement>(null);
  const closeWs                 = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!id) return;

    api.runs.get(id)
      .then(m => {
        setMeta(m);
        if (m.status === "passed" || m.status === "failed") {
          return api.runs.results(id).then(r => setResults(r as RunResult[]));
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    closeWs.current = openRunStream(id, (e) => {
      const event = e.event as string;

      if (event === "done") {
        const s = e.summary as { passed?: number; failed?: number; total?: number; score?: number; grade?: string } | undefined;
        const status = (e.status as string) ?? "unknown";
        const passed = status === "passed";
        let text = passed ? "✓ Run complete" : "✗ Run complete";
        if (s) {
          text += ` — ${s.passed ?? 0} passed, ${s.failed ?? 0} failed`;
          if (s.score !== undefined) text += ` · Score: ${s.score}/100 (${s.grade})`;
        }
        setLogs(prev => [...prev, { text, kind: passed ? "pass" : "fail" }]);
        api.runs.get(id).then(setMeta).catch(() => {});
        api.runs.results(id).then(r => setResults(r as RunResult[])).catch(() => {});
        return;
      }

      const msg = (e.message ?? e.label ?? e.error ?? "") as string;
      if (!msg) return;

      const kind: LogLine["kind"] =
        event === "step:pass" ? "pass" :
        event === "step:fail" ? "fail" :
        event === "info"      ? "info" : "log";

      setLogs(prev => [...prev, { text: msg, kind }]);
    });

    return () => { closeWs.current?.(); };
  }, [id]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

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

  const reportUrl      = api.runs.reportUrl(id);
  const effectiveStatus: RunMeta["status"] =
    (meta?.summary?.failed ?? 0) > 0 ? "failed" : (meta?.status ?? "queued");

  const toggleRow = (i: number) =>
    setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

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
        {meta?.status === "running" && (
          <button onClick={() => api.runs.cancel(id)} style={dangerBtn}>Cancel</button>
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
              {" "}— expand a failed row below to see step details and screenshots
            </div>
          </div>
        </div>
      )}

      {/* Meta cards */}
      {meta && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {[
            { label: "Type",    value: meta.type, color: "" },
            { label: "Started", value: meta.startedAt ? new Date(meta.startedAt).toLocaleString() : "—", color: "" },
            { label: "Ended",   value: meta.completedAt ? new Date(meta.completedAt).toLocaleString() : "—", color: "" },
            ...(meta.startedAt && meta.completedAt ? [{
              label: "Duration",
              value: `${((new Date(meta.completedAt).getTime() - new Date(meta.startedAt).getTime()) / 1000).toFixed(1)}s`,
              color: "",
            }] : []),
            ...(meta.summary ? [
              { label: "Passed", value: `${meta.summary.passed} / ${meta.summary.total}`,
                color: meta.summary.failed > 0 ? "#dc2626" : "#16a34a" },
              ...(meta.summary.score !== undefined ? [
                { label: "Score", value: `${meta.summary.score}/100 (${meta.summary.grade})`,
                  color: meta.summary.score >= 75 ? "#16a34a" : meta.summary.score >= 50 ? "#d97706" : "#dc2626" },
              ] : []),
            ] : []),
          ].map(c => (
            <div key={c.label} style={{ background: "#fff", borderRadius: 10, padding: "12px 18px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.color || undefined }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
        {(["live", "report"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 18px", borderRadius: "8px 8px 0 0",
            border: "1px solid #e2e8f0", borderBottom: tab === t ? "none" : "1px solid #e2e8f0",
            background: tab === t ? "#fff" : "#f8fafc",
            color: tab === t ? "#6366f1" : "#64748b",
            fontWeight: tab === t ? 600 : 400, fontSize: 13, cursor: "pointer",
          }}>
            {t === "live" ? "Live Log" : "HTML Report"}
          </button>
        ))}
      </div>

      {tab === "live" && (
        <div style={{ background: "#fff", borderRadius: "0 8px 8px 8px", border: "1px solid #e2e8f0" }}>
          {/* Log stream */}
          <div ref={logRef} style={{
            fontFamily: "monospace", fontSize: 12, padding: 16,
            height: 340, overflowY: "auto", background: "#0f172a",
            borderRadius: "0 8px 8px 8px",
          }}>
            {logs.length === 0 && <span style={{ color: "#475569" }}>Waiting for events…</span>}
            {logs.map((l, i) => (
              <div key={i} style={{
                color: l.kind === "pass" ? "#4ade80" : l.kind === "fail" ? "#f87171" : "#94a3b8",
                marginBottom: 2,
              }}>
                {l.text}
              </div>
            ))}
          </div>

          {/* Results table */}
          {results.length > 0 && (
            <div style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>
                Test Results
                <span style={{ fontWeight: 400, fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>
                  click a row to expand steps
                </span>
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
                      {/* Test row */}
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

                      {/* Step rows (expanded) */}
                      {expanded.has(i) && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0, borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ borderLeft: "3px solid #e2e8f0", marginLeft: 20 }}>
                              {(r.stepResults ?? []).map((s: StepResult, si: number) => (
                                <div
                                  key={si}
                                  style={{
                                    display: "flex", alignItems: "flex-start", gap: 10,
                                    padding: "7px 16px 7px 12px",
                                    background: s.passed ? "#f0fdf4" : "#fff1f2",
                                    borderBottom: si < (r.stepResults?.length ?? 0) - 1 ? "1px solid #f1f5f9" : "none",
                                  }}
                                >
                                  <span style={{ color: s.passed ? "#16a34a" : "#dc2626", fontWeight: 700, fontSize: 13, minWidth: 14, paddingTop: 1 }}>
                                    {s.passed ? "✓" : "✗"}
                                  </span>
                                  <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 22, paddingTop: 2 }}>
                                    {s.index + 1}.
                                  </span>
                                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "#334155", minWidth: 90 }}>
                                    {s.action}
                                  </span>
                                  <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 52, paddingTop: 2 }}>
                                    {s.durationMs}ms
                                  </span>
                                  {s.error && (
                                    <span style={{ fontSize: 11, color: "#dc2626", flex: 1, paddingTop: 2 }}>
                                      {humanizeError(s.error)}
                                    </span>
                                  )}
                                  {s.screenshotPath && (
                                    <a
                                      href={screenshotUrl(id, s.screenshotPath)}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      title="Open full-size screenshot"
                                    >
                                      <img
                                        src={screenshotUrl(id, s.screenshotPath)}
                                        alt="failure screenshot"
                                        style={{
                                          height: 56, width: "auto", borderRadius: 4,
                                          border: "1px solid #fecaca", display: "block",
                                        }}
                                      />
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

      {tab === "report" && (
        meta?.type === "orchestrate" ? (
          <iframe
            src={reportUrl}
            style={{ width: "100%", height: "calc(100vh - 260px)", border: "1px solid #e2e8f0", borderRadius: "0 8px 8px 8px", background: "#fff" }}
            title="AIQA HTML Report"
          />
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", background: "#fff", borderRadius: "0 8px 8px 8px", border: "1px solid #e2e8f0" }}>
            HTML reports are generated by <strong>Orchestrate</strong> runs.<br />
            <span style={{ fontSize: 12 }}>Use the Orchestrate tab to run a full pipeline with a scored report.</span>
          </div>
        )
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b" };
const tdStyle: React.CSSProperties = { padding: "10px 16px", fontSize: 12 };
const errStyle: React.CSSProperties = { background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 };
const dangerBtn: React.CSSProperties = { padding: "6px 14px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff", color: "#dc2626", fontSize: 12, cursor: "pointer" };
