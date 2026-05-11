import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Orchestrate() {
  const [url, setUrl]           = useState("");
  const [maxPages, setMaxPages] = useState("10");
  const [headless, setHeadless] = useState(true);
  const [dryRun, setDryRun]     = useState(false);
  const [running, setRunning]   = useState(false);
  const [error, setError]       = useState("");
  const navigate = useNavigate();

  const start = async () => {
    if (!url.trim()) { setError("URL is required"); return; }
    setError("");
    setRunning(true);
    try {
      const { runId } = await api.trigger.orchestrate(url, {
        maxPages: parseInt(maxPages, 10) || 10,
        headless,
        dryRun,
      });
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Orchestrate</h1>
      <p style={{ color: "#64748b", marginBottom: 28 }}>
        Full pipeline — explore → map flows → generate tests → run → score. One URL, one click.
      </p>

      <div style={{ maxWidth: 560, background: "#fff", borderRadius: 12, padding: 28, border: "1px solid #e2e8f0" }}>

        {error && <div style={errStyle}>{error}</div>}

        <Field label="Target URL" hint="The application you want to test">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://your-app.com"
            style={inputStyle}
          />
        </Field>

        <Field label="Max pages to crawl" hint="How deep to explore the application">
          <input
            type="number"
            value={maxPages}
            onChange={e => setMaxPages(e.target.value)}
            min={1} max={100}
            style={{ ...inputStyle, width: 100 }}
          />
        </Field>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "20px 0" }}>
          <label style={checkLabel}>
            <input type="checkbox" checked={headless} onChange={e => setHeadless(e.target.checked)} />
            Run browser headlessly (recommended for CI)
          </label>
          <label style={checkLabel}>
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            Dry run — explore and generate tests without executing them
          </label>
        </div>

        <button onClick={start} disabled={running || !url.trim()} style={primaryBtn(running)}>
          {running ? "Starting pipeline…" : "⚡ Start Orchestration"}
        </button>

        <div style={{ marginTop: 20, padding: "14px 16px", background: "#f8fafc", borderRadius: 8, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
          <strong style={{ color: "#475569" }}>What happens:</strong><br />
          1. Crawls the app and maps pages<br />
          2. Identifies user flows and generates YAML tests<br />
          3. Runs all tests in parallel<br />
          4. Produces a readiness score and recommendations
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{label}</label>
      {hint && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{hint}</div>}
      {children}
    </div>
  );
}

const errStyle: React.CSSProperties  = { background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none" };
const checkLabel: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", cursor: "pointer" };
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
  background: disabled ? "#c7d2fe" : "#6366f1", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
});
