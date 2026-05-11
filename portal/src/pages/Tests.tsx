import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, TestFile } from "../api";

export default function Tests() {
  const [files, setFiles]         = useState<TestFile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [selected, setSelected]   = useState<string | null>(null);
  const [content, setContent]     = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState("");
  const [edited, setEdited]       = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.tests.list()
      .then(setFiles)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const openFile = async (filePath: string) => {
    setSelected(filePath);
    setEdited(false);
    setSaveMsg("");
    setLoadingFile(true);
    try {
      const text = await api.tests.read(filePath);
      setContent(text);
    } catch (e) {
      setContent(`# Error loading file\n# ${(e as Error).message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  const saveFile = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await api.tests.write(selected, content);
      setSaveMsg("Saved");
      setEdited(false);
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setSaveMsg(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const openInEditor = () => {
    if (!selected) return;
    navigate("/editor", { state: { content, fileName: selected } });
  };

  const runFile = async () => {
    if (!selected) return;
    try {
      const { runId } = await api.trigger.run(content, { headless: true });
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ display: "flex", gap: 20, height: "calc(100vh - 80px)" }}>

      {/* File list */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Test Files</h1>
          <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>
            YAML tests in <code>tests/</code>
          </p>
        </div>

        {error && <div style={errStyle}>{error}</div>}
        {loading && <div style={{ color: "#64748b", fontSize: 13 }}>Loading…</div>}

        {!loading && files.length === 0 && !error && (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: "12px 0" }}>
            No YAML files found in <code>tests/</code>.<br />
            Create one in the Editor first.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {files.map(f => (
            <button
              key={f.path}
              onClick={() => openFile(f.path)}
              style={{
                textAlign: "left", padding: "9px 12px", borderRadius: 8,
                border: "1px solid " + (selected === f.path ? "#6366f1" : "#e2e8f0"),
                background: selected === f.path ? "#eef2ff" : "#fff",
                color: selected === f.path ? "#4338ca" : "#334155",
                fontSize: 13, fontWeight: selected === f.path ? 600 : 400,
                cursor: "pointer",
              }}
            >
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{f.name}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{f.path}</div>
            </button>
          ))}
        </div>
      </div>

      {/* File viewer / editor */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {selected ? (
          <>
            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#334155", fontFamily: "ui-monospace, monospace" }}>
                {selected}
              </span>
              {edited && <span style={{ fontSize: 11, color: "#d97706" }}>● unsaved</span>}
              <div style={{ flex: 1 }} />
              {saveMsg && (
                <span style={{ fontSize: 12, color: saveMsg.startsWith("Error") ? "#dc2626" : "#16a34a" }}>
                  {saveMsg}
                </span>
              )}
              <button onClick={saveFile} disabled={saving || !edited} style={secondaryBtn(!edited)}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={openInEditor} style={secondaryBtn(false)}>
                Open in Editor
              </button>
              <button onClick={runFile} style={primaryBtn}>
                ▶ Run
              </button>
            </div>

            {/* Editor area */}
            {loadingFile ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Loading…</div>
            ) : (
              <textarea
                value={content}
                onChange={e => { setContent(e.target.value); setEdited(true); }}
                spellCheck={false}
                style={{
                  flex: 1, fontFamily: "ui-monospace, 'Cascadia Code', monospace",
                  fontSize: 13, lineHeight: 1.6, padding: 16,
                  border: "1px solid #e2e8f0", borderRadius: 10,
                  background: "#fff", color: "#1e293b", resize: "none", outline: "none",
                }}
                onKeyDown={e => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const s = e.currentTarget.selectionStart;
                    const v = content;
                    setContent(v.slice(0, s) + "  " + v.slice(e.currentTarget.selectionEnd));
                    setTimeout(() => e.currentTarget.setSelectionRange(s + 2, s + 2), 0);
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                    e.preventDefault();
                    saveFile();
                  }
                }}
              />
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "#94a3b8", fontSize: 14 }}>
            Select a test file to view and edit it
          </div>
        )}
      </div>
    </div>
  );
}

const errStyle: React.CSSProperties = { background: "#fee2e2", color: "#dc2626", padding: "8px 12px", borderRadius: 8, fontSize: 12 };
const secondaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "6px 14px", borderRadius: 8, border: "1px solid #e2e8f0",
  background: disabled ? "#f8fafc" : "#fff", color: disabled ? "#94a3b8" : "#475569",
  fontSize: 12, cursor: disabled ? "not-allowed" : "pointer",
});
const primaryBtn: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 8, border: "none",
  background: "#6366f1", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
