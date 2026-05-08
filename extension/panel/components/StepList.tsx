import React from "react";
import { StepResult } from "../../shared/types";

const ICON: Record<StepResult["status"], string> = {
  pending: "○",
  running: "◌",
  passed:  "✓",
  failed:  "✗",
  skipped: "—",
};

const COLOR: Record<StepResult["status"], string> = {
  pending: "#aaa",
  running: "#1a73e8",
  passed:  "#188038",
  failed:  "#d93025",
  skipped: "#aaa",
};

interface Props {
  steps: StepResult[];
}

export function StepList({ steps }: Props) {
  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      <p style={{
        margin: "0 0 6px",
        fontSize: "11px",
        fontWeight: 600,
        color: "#666",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}>
        Steps
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
        {steps.map((step) => (
          <li key={step.index}>
            <div style={{ display: "flex", gap: "6px", alignItems: "baseline", fontSize: "12px" }}>
              <span style={{ color: COLOR[step.status], fontWeight: 700, width: "14px", flexShrink: 0 }}>
                {ICON[step.status]}
              </span>
              <span style={{ color: step.status === "failed" ? "#d93025" : "#222" }}>
                {step.label}
              </span>
            </div>
            {step.error && (
              <div style={{
                marginLeft: "20px",
                marginTop: "3px",
                padding: "4px 8px",
                fontSize: "11px",
                fontFamily: "monospace",
                color: "#c5221f",
                background: "#fce8e6",
                borderRadius: "3px",
                wordBreak: "break-word",
              }}>
                {step.error}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
