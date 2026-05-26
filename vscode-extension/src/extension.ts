import * as vscode from "vscode";
import { AiqaClient }             from "./AiqaClient";
import { RunPanel }               from "./RunPanel";
import { YamlCodeLensProvider, YamlCompletionProvider } from "./YamlCodeLens";

export function activate(context: vscode.ExtensionContext): void {
  const client     = new AiqaClient();
  const statusBar  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text   = "$(beaker) AIQA";
  statusBar.tooltip = "AIQA — click to show results";
  statusBar.command = "aiqa.showResults";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── CodeLens: "▶ Run with AIQA" on YAML test files ─────────────────────────
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: "yaml", scheme: "file" },
      new YamlCodeLensProvider(),
    ),
  );

  // ── YAML autocomplete for DSL keywords ─────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "yaml", scheme: "file" },
      new YamlCompletionProvider(),
      "-", " ",
    ),
  );

  // ── Command: run the currently open / right-clicked YAML file ──────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("aiqa.runFile", async (uriOrPath?: vscode.Uri | string) => {
      const filePath = uriOrPath instanceof vscode.Uri
        ? uriOrPath.fsPath
        : typeof uriOrPath === "string"
          ? uriOrPath
          : vscode.window.activeTextEditor?.document.uri.fsPath;

      if (!filePath) {
        vscode.window.showErrorMessage("AIQA: No YAML file selected.");
        return;
      }

      const headless = vscode.workspace.getConfiguration("aiqa").get<boolean>("headless", true);
      const panel    = RunPanel.show(context);
      panel.setRunning(filePath.split(/[/\\]/).pop() ?? filePath);
      statusBar.text = "$(sync~spin) AIQA running…";

      try {
        const accepted = await client.runFile(filePath, headless);
        const result   = await client.waitForRun(accepted.runId, (meta) => panel.update(meta));
        panel.update(result);
        const icon = result.status === "passed" ? "✅" : "❌";
        statusBar.text = `$(beaker) AIQA ${icon}`;
        const s = result.summary;
        if (s) vscode.window.showInformationMessage(
          `AIQA: ${result.status.toUpperCase()} — ${s.passed}/${s.total} passed`,
        );
      } catch (err) {
        statusBar.text = "$(beaker) AIQA ⚠️";
        vscode.window.showErrorMessage(`AIQA error: ${(err as Error).message}`);
      }
    }),
  );

  // ── Command: run all tests in the workspace tests/ directory ────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("aiqa.runAll", async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { vscode.window.showErrorMessage("AIQA: No workspace folder open."); return; }

      const cfg      = vscode.workspace.getConfiguration("aiqa");
      const headless = cfg.get<boolean>("headless", true);
      const panel    = RunPanel.show(context);
      panel.setRunning("all tests");
      statusBar.text = "$(sync~spin) AIQA running…";

      try {
        const accepted = await client.runAll("tests/", headless);
        const result   = await client.waitForRun(accepted.runId, (meta) => panel.update(meta));
        panel.update(result);
        const icon = result.status === "passed" ? "✅" : "❌";
        statusBar.text = `$(beaker) AIQA ${icon}`;
        const s = result.summary;
        if (s) vscode.window.showInformationMessage(
          `AIQA: ${result.status.toUpperCase()} — ${s.passed}/${s.total} passed`,
        );
      } catch (err) {
        statusBar.text = "$(beaker) AIQA ⚠️";
        vscode.window.showErrorMessage(`AIQA error: ${(err as Error).message}`);
      }
    }),
  );

  // ── Command: show/focus results panel ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("aiqa.showResults", () => { RunPanel.show(context); }),
  );

  // ── Command: open settings ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("aiqa.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "aiqa");
    }),
  );
}

export function deactivate(): void {
  RunPanel.currentPanel?.dispose();
}
