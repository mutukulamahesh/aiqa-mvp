/**
 * Options page — API key entry.
 * Loaded via panel/options.html (extension options_page).
 */

import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

const STORAGE_KEY = "aiqa:config";

function Options() {
  const [apiKey,  setApiKey]  = useState("");
  const [saved,   setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const config = result[STORAGE_KEY] as { apiKey?: string } | undefined;
      if (config?.apiKey) setApiKey(config.apiKey);
      setLoading(false);
    });
  }, []);

  const save = () => {
    const trimmed = apiKey.trim();
    chrome.storage.local.set({ [STORAGE_KEY]: { apiKey: trimmed } }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  };

  if (loading) return null;

  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, sans-serif",
      maxWidth: "480px",
      padding: "24px",
      color: "#222",
    }}>
      <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 700 }}>AIQA Options</h2>
      <p style={{ margin: "0 0 24px", fontSize: "13px", color: "#666" }}>
        Configure your Anthropic API key for AI test generation.
      </p>

      <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
        Anthropic API Key
      </label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
        placeholder="sk-ant-…"
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: "13px",
          border: "1px solid #ccc",
          borderRadius: "4px",
          boxSizing: "border-box",
          fontFamily: "monospace",
          marginBottom: "10px",
        }}
      />

      {/* Plaintext storage warning — required by the plan */}
      <div style={{
        padding: "10px 12px",
        background: "#fef9c3",
        border: "1px solid #f5d000",
        borderRadius: "4px",
        fontSize: "12px",
        color: "#713f12",
        marginBottom: "14px",
        lineHeight: 1.5,
      }}>
        <strong>Security notice:</strong> Your API key is stored in plaintext in{" "}
        <code>chrome.storage.local</code>. Anyone with access to your Chrome profile
        can read it. Do not use AIQA on shared machines with sensitive keys.
      </div>

      <button
        onClick={save}
        disabled={!apiKey.trim()}
        style={{
          padding: "8px 20px",
          fontSize: "13px",
          fontWeight: 600,
          background: "#1a73e8",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Save
      </button>

      {saved && (
        <span style={{ marginLeft: "12px", fontSize: "13px", color: "#188038" }}>
          Saved.
        </span>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Options />);
}
