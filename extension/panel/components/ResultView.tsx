import React from "react";
import { RunStatus } from "../../shared/types";

interface Props {
  status: RunStatus;
}

export function ResultView({ status }: Props) {
  const ok = status === "passed";
  return (
    <div style={{
      padding: "10px 14px",
      borderRadius: "6px",
      background: ok ? "#e6f4ea" : "#fce8e6",
      color: ok ? "#188038" : "#d93025",
      fontWeight: 700,
      fontSize: "14px",
      textAlign: "center",
      letterSpacing: "0.03em",
    }}>
      {ok ? "PASSED" : "FAILED"}
    </div>
  );
}
