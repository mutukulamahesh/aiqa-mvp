import React from "react";

interface Props {
  yaml:         string;
  onYamlChange: (yaml: string) => void;
  onRun:        (yaml: string) => void;
  onSmoke:      () => void;
  disabled:     boolean;
}

export function TestInput({ yaml, onYamlChange, onRun, onSmoke, disabled }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <label style={{ fontSize: "11px", fontWeight: 600, color: "#555" }}>
        YAML test:
      </label>
      <textarea
        value={yaml}
        onChange={(e) => onYamlChange(e.target.value)}
        disabled={disabled}
        rows={7}
        spellCheck={false}
        style={{
          fontFamily: "monospace",
          fontSize: "12px",
          padding: "8px",
          border: "1px solid #ddd",
          borderRadius: "4px",
          resize: "vertical",
          width: "100%",
          boxSizing: "border-box",
          color: "#222",
          background: disabled ? "#f9f9f9" : "#fff",
        }}
        placeholder="Paste YAML test here or use Generate above…"
      />
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onSmoke}
          disabled={disabled}
          style={btn("#f1f3f4", "#333")}
        >
          Smoke test
        </button>
        <button
          onClick={() => onRun(yaml)}
          disabled={disabled || !yaml.trim()}
          style={btn(disabled ? "#c8d8f8" : "#1a73e8", "#fff")}
        >
          {disabled ? "Running…" : "Run"}
        </button>
      </div>
    </div>
  );
}

function btn(bg: string, color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "7px 0",
    border: "none",
    borderRadius: "4px",
    background: bg,
    color,
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
  };
}
