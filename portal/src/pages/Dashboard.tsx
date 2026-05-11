import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, RunMeta } from "../api";
import StatusBadge from "../components/StatusBadge";

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 12, padding: "20px 24px",
      border: "1px solid #e2e8f0", flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [runs, setRuns]     = useState<RunMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.runs.list()
      .then(r => setRuns(r.slice(0, 20)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const completed = runs.filter(r => r.status === "passed" || r.status === "failed");
  const passed    = completed.filter(r => r.status === "passed").length;
  const passRate  = completed.length ? Math.round((passed / completed.length) * 100) : 0;
  const running   = runs.filter(r => r.status === "running").length;
  const lastScore = runs.find(r => r.summary?.score !== undefined)?.summary?.score;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Dashboard</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>Overview of recent test runs and platform health.</p>

      {error && <div style={errStyle}>{error}</div>}
      {loading && <div style={{ color: "#64748b" }}>Loading...</div>}

      {!loading && !error && (
        <>
          {/* Stat cards */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
            <StatCard label="Pass rate (last 20)"  value={`${passRate}%`}         color={passRate >= 75 ? "#16a34a" : passRate >= 50 ? "#d97706" : "#dc2626"} />
            <StatCard label="Runs completed"        value={completed.length}        color="#6366f1" />
            <StatCard label="Currently running"     value={running}                 color="#2563eb" />
            {lastScore !== undefined && <StatCard label="Last readiness score" value={`${lastScore}/100`} color="#0ea5e9" />}
          </div>

          {/* Pass rate bar */}
          {completed.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, padding: "18px 24px", border: "1px solid #e2e8f0", marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Pass rate trend (last {completed.length} runs)</div>
              <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 40 }}>
                {completed.slice(-20).map((r, i) => (
                  <div key={i} title={r.runId} onClick={() => navigate(`/runs/${r.runId}`)} style={{
                    flex: 1, height: r.status === "passed" ? "100%" : "40%",
                    background: r.status === "passed" ? "#22c55e" : "#ef4444",
                    borderRadius: "3px 3px 0 0", cursor: "pointer", minWidth: 8,
                    transition: "opacity 0.15s",
                  }} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Click a bar to view run details</div>
            </div>
          )}

          {/* Recent runs table */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", fontWeight: 600, fontSize: 14 }}>
              Recent Runs
            </div>
            {runs.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
                No runs yet. Start with the <strong>Editor</strong> or <strong>Orchestrate</strong> tab.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Run ID", "Type", "Status", "Score", "Started"].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.runId} onClick={() => navigate(`/runs/${r.runId}`)}
                      style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={tdStyle}><code style={{ fontSize: 11, color: "#6366f1" }}>{r.runId.slice(0, 20)}…</code></td>
                      <td style={tdStyle}><span style={{ color: "#64748b" }}>{r.type}</span></td>
                      <td style={tdStyle}><StatusBadge status={r.status} /></td>
                      <td style={tdStyle}>{r.summary?.score !== undefined ? `${r.summary.score}/100 (${r.summary.grade})` : "—"}</td>
                      <td style={tdStyle}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "10px 20px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" };
const tdStyle: React.CSSProperties = { padding: "12px 20px", fontSize: 13 };
const errStyle: React.CSSProperties = { background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 };
