import React, { useState } from "react";
import { useNavigate, useLocation, useBlocker } from "react-router-dom";
import { api } from "../api";
import { EnvVarPanel, EnvVar, envVarsToRecord } from "../components/EnvVarPanel";

const SAMPLE = `test:
  name: "My Test"
  tags: [smoke]
  steps:
    - navigate: "https://example.com"
    - assert:
        text: "Example Domain"
    - assert:
        url: "example.com"
`;

export default function Editor() {
  const location = useLocation();
  const state    = location.state as { content?: string; fileName?: string } | null;

  const [yaml, setYaml]         = useState(state?.content ?? SAMPLE);
  const [fileName, setFileName] = useState<string | null>(state?.fileName ?? null);
  const [headless, setHeadless] = useState(true);
  const [vars, setVars]         = useState<EnvVar[]>([]);
  const [running, setRunning]   = useState(false);
  const [error, setError]       = useState("");
  const [edited, setEdited]     = useState(false);
  const navigate = useNavigate();

  useBlocker(({ currentLocation, nextLocation }) =>
    edited && currentLocation.pathname !== nextLocation.pathname
      ? !window.confirm("You have unsaved changes. Leave anyway?")
      : false
  );

  const run = async () => {
    if (!yaml.trim()) return;
    setError("");
    setRunning(true);
    try {
      const { runId } = await api.trigger.run(yaml, { headless, vars: envVarsToRecord(vars) });
      setEdited(false);
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>YAML Editor</h1>
      <p style={{ color: "#64748b", marginBottom: 20 }}>
        Write or paste a YAML test, then run it directly from the browser.
      </p>

      {error && <div style={errStyle}>{error}</div>}

      {fileName && (
        <div style={{ fontSize: 12, color: "#6366f1", marginBottom: 10, fontFamily: "ui-monospace, monospace" }}>
          Editing: {fileName}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#475569", cursor: "pointer" }}>
          <input type="checkbox" checked={headless} onChange={e => setHeadless(e.target.checked)} />
          Headless mode
        </label>
        <div style={{ flex: 1 }} />
        {edited && <span style={{ fontSize: 11, color: "#d97706" }}>● unsaved</span>}
        <button onClick={() => {
          if (edited && !window.confirm("You have unsaved changes. Discard them?")) return;
          setYaml(SAMPLE); setFileName(null); setEdited(false);
        }} style={secondaryBtn}>Reset sample</button>
        <button onClick={run} disabled={running || !yaml.trim()} style={primaryBtn(running)}>
          {running ? "Starting…" : "▶ Run"}
        </button>
      </div>

      {/* Editor */}
      <textarea
        value={yaml}
        onChange={e => { setYaml(e.target.value); setEdited(true); }}
        spellCheck={false}
        style={{
          width: "100%", height: "calc(100vh - 360px)",
          fontFamily: "ui-monospace, 'Cascadia Code', monospace",
          fontSize: 13, lineHeight: 1.6,
          padding: 16, border: "1px solid #e2e8f0", borderRadius: 10,
          background: "#fff", color: "#1e293b", resize: "none",
          outline: "none", tabSize: 2,
        }}
        onKeyDown={e => {
          if (e.key === "Tab") {
            e.preventDefault();
            const s = e.currentTarget.selectionStart;
            const v = yaml;
            setYaml(v.slice(0, s) + "  " + v.slice(e.currentTarget.selectionEnd));
            setTimeout(() => e.currentTarget.setSelectionRange(s + 2, s + 2), 0);
          }
        }}
      />

      {/* Env vars */}
      <div style={{ marginTop: 14 }}>
        <EnvVarPanel vars={vars} onChange={setVars} />
      </div>

      {/* YAML hint */}
      <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
        Supported actions: navigate · click · fill · assert (text/url/visible) · wait_for_element · wait_ms · store · if · for_each · judge
      </div>
    </div>
  );
}

const errStyle: React.CSSProperties = { background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 };
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 20px", borderRadius: 8, border: "none",
  background: disabled ? "#c7d2fe" : "#6366f1", color: "#fff",
  fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
});
const secondaryBtn: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 8, border: "1px solid #e2e8f0",
  background: "#fff", color: "#475569", fontSize: 13, cursor: "pointer",
};
