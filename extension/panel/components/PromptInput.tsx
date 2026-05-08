import React, { useState } from "react";

interface Props {
  onGenerate:  (prompt: string) => void;
  generating:  boolean;
}

export function PromptInput({ onGenerate, generating }: Props) {
  const [prompt, setPrompt] = useState("");

  const submit = () => {
    if (prompt.trim()) onGenerate(prompt.trim());
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label style={{ fontSize: "11px", fontWeight: 600, color: "#555" }}>
        Describe what to test (AI):
      </label>
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          disabled={generating}
          placeholder="e.g. test that I can sign up and reach the dashboard"
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: "12px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            color: "#222",
          }}
        />
        <button
          onClick={submit}
          disabled={generating || !prompt.trim()}
          style={{
            padding: "6px 10px",
            fontSize: "12px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            background: "#f1f3f4",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {generating ? "Generating…" : "Generate"}
        </button>
      </div>
    </div>
  );
}
