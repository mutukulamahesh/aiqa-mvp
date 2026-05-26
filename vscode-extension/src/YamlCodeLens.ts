import * as vscode from "vscode";

const DSL_FIRST_LINE = /^name:\s*.+/;

export class YamlCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const firstLine = document.lineAt(0).text;
    if (!DSL_FIRST_LINE.test(firstLine)) return [];

    const range = new vscode.Range(0, 0, 0, firstLine.length);
    return [
      new vscode.CodeLens(range, {
        title:     "▶ Run with AIQA",
        tooltip:   "Run this test file via the AIQA server",
        command:   "aiqa.runFile",
        arguments: [document.uri.fsPath],
      }),
    ];
  }
}

export class YamlCompletionProvider implements vscode.CompletionItemProvider {
  private static readonly TOP_LEVEL = [
    "name", "tags", "source", "steps",
  ].map(k => {
    const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
    item.insertText = new vscode.SnippetString(`${k}: $0`);
    return item;
  });

  private static readonly STEPS = [
    ["navigate",               "navigate: ${1:https://example.com}"],
    ["click",                  "click: \"${1:selector}\""],
    ["fill",                   "fill:\n  target: \"${1:selector}\"\n  value: \"${2:text}\""],
    ["assert_text_visible",    "assert_text_visible: \"${1:expected text}\""],
    ["assert_url_contains",    "assert_url_contains: \"${1:/path}\""],
    ["assert_element_visible", "assert_element_visible: \"${1:selector}\""],
    ["wait_for_element",       "wait_for_element: \"${1:selector}\""],
    ["wait_ms",                "wait_ms: ${1:500}"],
    ["store",                  "store:\n  from: \"${1:selector}\"\n  as: ${2:varName}"],
    ["judge",                  "judge:\n  prompt: \"${1:Was the action correct?}\"\n  value: \"${2:\\${capturedText}}\"\n  pass_if: \">= ${3:0.7}\""],
    ["llm_eval",               "llm_eval:\n  target: ${1:fast}\n  prompt: \"${2:prompt}\"\n  assert_quality:\n    criteria: \"${3:criteria}\"\n    pass_if: \"score >= ${4:0.8}\""],
    ["api",                    "api:\n  method: ${1:GET}\n  url: \"${2:http://localhost/api/...}\"\n  assert_status: ${3:200}"],
  ].map(([label, snippet]) => {
    const item = new vscode.CompletionItem(`- ${label}`, vscode.CompletionItemKind.Snippet);
    item.insertText = new vscode.SnippetString(`- ${snippet}`);
    item.detail     = "AIQA DSL step";
    return item;
  });

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    if (linePrefix.trimStart().startsWith("-")) return YamlCompletionProvider.STEPS;
    if (position.character === 0)               return YamlCompletionProvider.TOP_LEVEL;
    return [];
  }
}
