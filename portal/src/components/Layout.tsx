import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { getApiKey, setApiKey } from "../api";

const NAV: { path: string; label: string; icon: string }[] = [
  { path: "/",            label: "Dashboard",  icon: "◈" },
  { path: "/runs",        label: "Runs",       icon: "▶" },
  { path: "/editor",      label: "Editor",     icon: "✎" },
  { path: "/orchestrate", label: "Orchestrate",icon: "⚡" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [showKey, setShowKey]   = useState(false);
  const [keyInput, setKeyInput] = useState(getApiKey());
  const navigate = useNavigate();

  const saveKey = () => { setApiKey(keyInput); setShowKey(false); };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

      {/* Sidebar */}
      <aside style={{
        width: 220, background: "#1e293b", color: "#e2e8f0",
        display: "flex", flexDirection: "column", flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 20px 12px", borderBottom: "1px solid #334155" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
            🧪 AIQA
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Enterprise AI QA Platform</div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px" }}>
          {NAV.map(n => (
            <NavLink key={n.path} to={n.path} end={n.path === "/"} style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 8, marginBottom: 2,
              color: isActive ? "#fff" : "#94a3b8",
              background: isActive ? "#6366f1" : "transparent",
              fontWeight: isActive ? 600 : 400,
              fontSize: 13,
              transition: "all 0.15s",
            })}>
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        {/* API Key */}
        <div style={{ padding: "12px 10px", borderTop: "1px solid #334155" }}>
          {showKey ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                placeholder="Bearer token / API key"
                type="password"
                style={{
                  padding: "6px 8px", borderRadius: 6, border: "1px solid #475569",
                  background: "#0f172a", color: "#e2e8f0", fontSize: 11, width: "100%",
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveKey} style={btnStyle("#6366f1")}>Save</button>
                <button onClick={() => setShowKey(false)} style={btnStyle("#475569")}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowKey(true)} style={{
              width: "100%", textAlign: "left", padding: "8px 12px",
              borderRadius: 8, border: "none", background: "transparent",
              color: "#64748b", fontSize: 12, cursor: "pointer",
            }}>
              🔑 {getApiKey() ? "API key set" : "Set API key"}
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: "auto", padding: 28 }}>
        {children}
      </main>

    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    flex: 1, padding: "5px 0", borderRadius: 6, border: "none",
    background: bg, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
  };
}
