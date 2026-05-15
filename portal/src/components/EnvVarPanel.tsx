import React from "react";

export interface EnvVar { key: string; value: string }

export function EnvVarPanel({ vars, onChange }: {
  vars: EnvVar[];
  onChange: (vars: EnvVar[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const filled = vars.filter(v => v.key.trim()).length;

  const addRow  = () => onChange([...vars, { key: "", value: "" }]);
  const remove  = (i: number) => onChange(vars.filter((_, j) => j !== i));
  const update  = (i: number, field: "key" | "value", val: string) =>
    onChange(vars.map((v, j) => j === i ? { ...v, [field]: val } : v));

  return (
    <div style={{ marginBottom: 18 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
          color: "#6366f1", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ fontSize: 10 }}>{open ? "▾" : "▸"}</span>
        Environment Variables
        {filled > 0 && (
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>({filled} set)</span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10, padding: "12px 14px", background: "#f8fafc",
          borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
            Inject credentials at runtime. Values are never stored in YAML files or run history.
          </div>
          {vars.map((v, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input
                placeholder="KEY_NAME"
                value={v.key}
                onChange={e => update(i, "key", e.target.value)}
                style={envInput}
                spellCheck={false}
              />
              <input
                placeholder="value"
                type="password"
                value={v.value}
                onChange={e => update(i, "value", e.target.value)}
                style={{ ...envInput, flex: 2 }}
              />
              <button onClick={() => remove(i)} style={removeBtn} title="Remove">✕</button>
            </div>
          ))}
          <button onClick={addRow} style={addRowBtn}>+ Add variable</button>
        </div>
      )}
    </div>
  );
}

export function envVarsToRecord(vars: EnvVar[]): Record<string, string> | undefined {
  const filled = vars.filter(v => v.key.trim() && v.value);
  if (filled.length === 0) return undefined;
  return Object.fromEntries(filled.map(v => [v.key.trim(), v.value]));
}

const envInput: React.CSSProperties = {
  flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0",
  fontSize: 12, fontFamily: "ui-monospace, monospace", background: "#fff",
};
const removeBtn: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, border: "1px solid #fecaca",
  background: "#fff", color: "#dc2626", fontSize: 11, cursor: "pointer",
};
const addRowBtn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 6, border: "1px solid #e2e8f0",
  background: "#fff", color: "#6366f1", fontSize: 12, cursor: "pointer", fontWeight: 500,
};
