import React from "react";

interface State { hasError: boolean; message: string }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#1e293b" }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20, maxWidth: 400, margin: "0 auto 20px" }}>
            {this.state.message || "An unexpected error occurred."}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: 13 }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
