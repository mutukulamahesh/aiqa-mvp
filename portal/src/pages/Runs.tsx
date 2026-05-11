import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, RunMeta } from "../api";
import StatusBadge from "../components/StatusBadge";

export default function Runs() {
  const [runs, setRuns]       = useState<RunMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [filter, setFilter]   = useState<string>("all");
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.runs.list()
      .then(setRuns)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const statuses = ["all", "passed", "failed", "running", "queued", "error", "cancelled"];
  const visible  = filter === "all" ? runs : runs.filter(r => r.status === filter);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Runs</h1>
          <p style={{ color: "#64748b", marginTop: 2 }}>{runs.length} total runs</p>
        </div>
        <button onClick={load} style={refreshBtn}>↻ Refresh</button>
      </div>

      {error && <div style={errStyle}>{error}</div>}

      {/* Status filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: "5px 14px", borderRadius: 20, border: "1px solid #e2e8f0",
            background: filter === s ? "#6366f1" : "#fff",
            color: filter === s ? "#fff" : "#64748b",
            fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}>
            {s === "all" ? `All (${runs.length})` : `${s} (${runs.filter(r => r.status === s).length})`}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: "#64748b" }}>Loading...</div>}

      {!loading && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          {visible.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No runs match this filter.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Run ID", "Type", "Status", "Tests", "Score", "Duration", "Started"].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(r => {
                  const dur = r.startedAt && r.completedAt
                    ? `${((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000).toFixed(1)}s`
                    : r.status === "running" ? "running…" : "—";
                  return (
                    <tr key={r.runId}
                      onClick={() => navigate(`/runs/${r.runId}`)}
                      style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={tdStyle}><code style={{ fontSize: 11, color: "#6366f1" }}>{r.runId.slice(0, 24)}…</code></td>
                      <td style={tdStyle}>{r.type}</td>
                      <td style={tdStyle}><StatusBadge status={(r.summary?.failed ?? 0) > 0 ? "failed" : r.status} /></td>
                      <td style={tdStyle}>
                        {r.summary ? (
                          <span>
                            <span style={{ color: "#16a34a", fontWeight: 600 }}>{r.summary.passed}✓</span>
                            {" / "}
                            <span style={{ color: "#dc2626" }}>{r.summary.failed}✗</span>
                            {" / "}
                            {r.summary.total}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={tdStyle}>{r.summary?.score !== undefined ? `${r.summary.score}/100` : "—"}</td>
                      <td style={tdStyle}>{dur}</td>
                      <td style={tdStyle}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "10px 20px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" };
const tdStyle: React.CSSProperties = { padding: "12px 20px", fontSize: 13 };
const errStyle: React.CSSProperties = { background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 };
const refreshBtn: React.CSSProperties = { padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", fontWeight: 500 };
