import React, { useState, useEffect, useCallback, useRef } from "react";
import { StepResult, RunStatus, StepEvent } from "../shared/types";
import { PromptInput } from "./components/PromptInput";
import { TestInput }   from "./components/TestInput";
import { StepList }    from "./components/StepList";
import { ResultView }  from "./components/ResultView";

const DEFAULT_YAML = `test:
  name: My test
  steps:
    - navigate: https://example.com
    - assert:
        text: Example Domain
`;

type AppStatus = "idle" | "running" | "generating" | "recording" | RunStatus;

export function App() {
  const [status,    setStatus]    = useState<AppStatus>("idle");
  const [steps,     setSteps]     = useState<StepResult[]>([]);
  const [yaml,      setYaml]      = useState(DEFAULT_YAML);
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Connect to the service worker once; stay connected to receive step events.
  useEffect(() => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: "aiqa:run" });
    } catch {
      setErrorMsg("Could not connect to extension background. Try reloading the panel.");
      return;
    }
    portRef.current = port;

    port.onMessage.addListener((event: StepEvent) => {
      switch (event.kind) {
        case "step:start":
          setSteps((prev) => {
            const next = [...prev];
            next[event.index] = { index: event.index, label: event.label, status: "running" };
            return next;
          });
          break;
        case "step:pass":
          setSteps((prev) => {
            const next = [...prev];
            if (next[event.index]) next[event.index] = { ...next[event.index], status: "passed" };
            return next;
          });
          break;
        case "step:fail":
          setSteps((prev) => {
            const next = [...prev];
            if (next[event.index]) {
              next[event.index] = { ...next[event.index], status: "failed", error: event.error };
            }
            return next;
          });
          break;
        case "run:done":
          setSteps(event.steps);
          setStatus(event.status);
          break;
        case "recorded:yaml":
          setYaml(event.yaml);
          setStatus("idle");
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
      setStatus((prev) => (prev === "running" ? "failed" : prev));
    });

    return () => { port.disconnect(); };
  }, []);

  const handleRun = useCallback((yamlText: string) => {
    setStatus("running");
    setSteps([]);
    setErrorMsg(null);
    chrome.runtime.sendMessage({ type: "run:yaml", yaml: yamlText });
  }, []);

  const handleSmoke = useCallback(() => {
    setStatus("running");
    setSteps([]);
    setErrorMsg(null);
    chrome.runtime.sendMessage({ type: "run:smoke" });
  }, []);

  const handleRecordToggle = useCallback(() => {
    if (status === "recording") {
      chrome.runtime.sendMessage({ type: "record:stop" });
      setStatus("idle");
    } else {
      chrome.runtime.sendMessage({ type: "record:start" });
      setStatus("recording");
    }
    setErrorMsg(null);
  }, [status]);

  const handleGenerate = useCallback((prompt: string) => {
    setStatus("generating");
    setErrorMsg(null);
    chrome.runtime.sendMessage(
      { type: "generate", prompt },
      (res: { ok: boolean; yaml?: string; error?: string }) => {
        if (res?.ok && res.yaml) {
          setYaml(res.yaml.trim());
          setStatus("idle");
        } else {
          setErrorMsg(res?.error ?? "Generation failed");
          setStatus("idle");
        }
      }
    );
  }, []);

  const isRunning    = status === "running";
  const isGenerating = status === "generating";
  const isRecording  = status === "recording";
  const isBusy       = isRunning || isGenerating;

  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "12px",
      height: "100vh",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: "0 0 1px", fontSize: "15px", fontWeight: 700, color: "#111" }}>AIQA</h2>
        <p style={{ margin: 0, fontSize: "11px", color: "#888" }}>Browser test runner</p>
      </div>

      {errorMsg && (
        <div style={{
          fontSize: "12px",
          color: "#c5221f",
          background: "#fce8e6",
          padding: "8px 10px",
          borderRadius: "4px",
        }}>
          {errorMsg}
        </div>
      )}

      {/* Record mode toggle */}
      <div>
        <button
          onClick={handleRecordToggle}
          disabled={isBusy}
          style={{
            width: "100%",
            padding: "7px 0",
            border: `1px solid ${isRecording ? "#d93025" : "#ddd"}`,
            borderRadius: "4px",
            background: isRecording ? "#fce8e6" : "#f1f3f4",
            color: isRecording ? "#d93025" : "#333",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {isRecording ? "Stop Recording" : "Record"}
        </button>
        {isRecording && (
          <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#d93025" }}>
            Click through your app — interactions are being captured.
          </p>
        )}
      </div>

      <PromptInput onGenerate={handleGenerate} generating={isGenerating} />

      <TestInput
        yaml={yaml}
        onYamlChange={setYaml}
        onRun={handleRun}
        onSmoke={handleSmoke}
        disabled={isBusy}
      />

      {steps.length > 0 && <StepList steps={steps} />}

      {(status === "passed" || status === "failed") && (
        <ResultView status={status} />
      )}
    </div>
  );
}
