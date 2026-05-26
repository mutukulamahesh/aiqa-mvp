import * as vscode from "vscode";
import type { RunMeta } from "./AiqaClient";

export class RunPanel {
  static currentPanel: RunPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): RunPanel {
    if (RunPanel.currentPanel) {
      RunPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return RunPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      "aiqaResults", "AIQA Results",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    RunPanel.currentPanel = new RunPanel(panel, context);
    return RunPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, _context: vscode.ExtensionContext) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._loading();
  }

  update(meta: RunMeta): void {
    this._panel.webview.html = this._render(meta);
  }

  setRunning(label: string): void {
    this._panel.webview.html = this._loading(label);
  }

  private _loading(label = "Running…"): string {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:1em">
      <h2>⏳ AIQA — ${label}</h2></body></html>`;
  }

  private _render(meta: RunMeta): string {
    const icon    = meta.status === "passed" ? "✅" : meta.status === "failed" ? "❌" : "⚠️";
    const summary = meta.summary
      ? `<p>Passed: <strong>${meta.summary.passed}</strong> &nbsp; Failed: <strong>${meta.summary.failed}</strong> &nbsp; Total: <strong>${meta.summary.total}</strong></p>`
      : "";
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:1em">
      <h2>${icon} AIQA — ${meta.status.toUpperCase()}</h2>
      ${summary}
      <p style="color:#888;font-size:0.85em">Run ID: ${meta.runId}</p>
      ${meta.completedAt ? `<p style="color:#888;font-size:0.85em">Completed: ${meta.completedAt}</p>` : ""}
    </body></html>`;
  }

  dispose(): void {
    RunPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}
