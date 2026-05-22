/**
 * GEN-03 spike — TraceParser unit tests
 * Uses static fixture data; no API keys or network calls required.
 */

import { normaliseOpenAI, normaliseLangChain, parseTrace, AgentTrace } from "../../src/ai-testing/TraceParser";

// ── OpenAI Assistants fixtures ────────────────────────────────────────────────

const openAISteps = [
  {
    id:         "step_001",
    type:       "tool_calls" as const,
    status:     "completed" as const,
    created_at: 1700000000,
    completed_at: 1700000003,
    step_details: {
      type: "tool_calls" as const,
      tool_calls: [
        {
          id:   "call_abc",
          type: "function" as const,
          function: { name: "get_weather", arguments: '{"city":"London"}', output: "15°C, cloudy" },
        },
      ],
    },
  },
  {
    id:         "step_002",
    type:       "tool_calls" as const,
    status:     "completed" as const,
    created_at: 1700000004,
    completed_at: 1700000007,
    step_details: {
      type: "tool_calls" as const,
      tool_calls: [
        {
          id:   "call_def",
          type: "function" as const,
          function: { name: "search_news", arguments: '{"q":"London weather"}', output: "Rainy week ahead" },
        },
        {
          id:   "call_ghi",
          type: "code_interpreter" as const,
        },
      ],
    },
  },
  {
    id:         "step_003",
    type:       "message_creation" as const,
    status:     "completed" as const,
    created_at: 1700000008,
    completed_at: 1700000010,
    step_details: {
      type: "message_creation" as const,
      message_creation: { message_id: "msg_xyz" },
    },
  },
  {
    id:         "step_004",
    type:       "tool_calls" as const,
    status:     "failed" as const,
    created_at: 1700000011,
    completed_at: null,
    step_details: {
      type: "tool_calls" as const,
      tool_calls: [
        {
          id:   "call_jkl",
          type: "function" as const,
          function: { name: "broken_tool", arguments: "{}", output: null },
        },
      ],
    },
  },
];

// ── LangChain fixtures ────────────────────────────────────────────────────────

const langChainRun = {
  id:         "run-root",
  name:       "AgentExecutor",
  run_type:   "chain",
  inputs:     { input: "What is the weather in London?" },
  outputs:    { output: "It is 15°C and cloudy in London." },
  error:      undefined,
  start_time: "2024-01-01T00:00:00.000Z",
  end_time:   "2024-01-01T00:00:10.000Z",
  child_runs: [
    {
      id:         "run-llm",
      name:       "ChatOpenAI",
      run_type:   "llm",
      inputs:     { messages: [["human", "What is the weather in London?"]] },
      outputs:    { generations: [["tool call: get_weather"]] },
      error:      undefined,
      start_time: "2024-01-01T00:00:01.000Z",
      end_time:   "2024-01-01T00:00:03.000Z",
      child_runs: [],
    },
    {
      id:         "run-tool",
      name:       "get_weather",
      run_type:   "tool",
      inputs:     { city: "London" },
      outputs:    { output: "15°C, cloudy" },
      error:      undefined,
      start_time: "2024-01-01T00:00:03.000Z",
      end_time:   "2024-01-01T00:00:05.000Z",
      child_runs: [],
    },
    {
      id:         "run-retriever",
      name:       "VectorStoreRetriever",
      run_type:   "retriever",
      inputs:     { query: "London weather" },
      outputs:    { documents: ["doc1", "doc2"] },
      error:      undefined,
      start_time: "2024-01-01T00:00:05.000Z",
      end_time:   "2024-01-01T00:00:06.000Z",
      child_runs: [],
    },
    {
      id:         "run-err",
      name:       "broken_tool",
      run_type:   "tool",
      inputs:     {},
      outputs:    undefined,
      error:      "Tool unavailable",
      start_time: "2024-01-01T00:00:06.000Z",
      end_time:   "2024-01-01T00:00:07.000Z",
      child_runs: [],
    },
  ],
};

// ── normaliseOpenAI ───────────────────────────────────────────────────────────

describe("normaliseOpenAI", () => {
  let trace: AgentTrace;
  beforeAll(() => { trace = normaliseOpenAI(openAISteps as never); });

  test("provider is openai", () => {
    expect(trace.provider).toBe("openai");
  });

  test("expands multi-tool steps into individual TraceSteps", () => {
    // step_001: 1 tool, step_002: 2 tools, step_003: message_creation, step_004: 1 tool = 5 steps
    expect(trace.steps).toHaveLength(5);
  });

  test("function tool call mapped to type=tool with name and output", () => {
    const step = trace.steps[0];
    expect(step.type).toBe("tool");
    expect(step.name).toBe("get_weather");
    expect(step.input).toBe('{"city":"London"}');
    expect(step.output).toBe("15°C, cloudy");
    expect(step.status).toBe("success");
  });

  test("duration computed from created_at and completed_at", () => {
    expect(trace.steps[0].durationMs).toBe(3000);
  });

  test("non-function tool (code_interpreter) uses type as name", () => {
    const step = trace.steps[2]; // second tool in step_002
    expect(step.type).toBe("tool");
    expect(step.name).toBe("code_interpreter");
  });

  test("message_creation step mapped to type=llm", () => {
    const step = trace.steps[3];
    expect(step.type).toBe("llm");
    expect(step.name).toBe("message_creation");
    expect(step.status).toBe("success");
  });

  test("failed step status mapped to error", () => {
    const step = trace.steps[4];
    expect(step.status).toBe("error");
  });

  test("null completed_at gives undefined durationMs", () => {
    const step = trace.steps[4];
    expect(step.durationMs).toBeUndefined();
  });

  test("raw preserved on trace", () => {
    expect(trace.raw).toBe(openAISteps);
  });
});

// ── normaliseLangChain ────────────────────────────────────────────────────────

describe("normaliseLangChain", () => {
  let trace: AgentTrace;
  beforeAll(() => { trace = normaliseLangChain(langChainRun as never); });

  test("provider is langchain", () => {
    expect(trace.provider).toBe("langchain");
  });

  test("DFS flattens root + all child_runs", () => {
    // root(chain) + llm + tool + retriever + broken_tool = 5
    expect(trace.steps).toHaveLength(5);
  });

  test("root chain step is first", () => {
    expect(trace.steps[0].type).toBe("chain");
    expect(trace.steps[0].name).toBe("AgentExecutor");
    expect(trace.steps[0].status).toBe("success");
  });

  test("llm run_type mapped to type=llm", () => {
    expect(trace.steps[1].type).toBe("llm");
    expect(trace.steps[1].name).toBe("ChatOpenAI");
  });

  test("tool run_type mapped to type=tool", () => {
    expect(trace.steps[2].type).toBe("tool");
    expect(trace.steps[2].name).toBe("get_weather");
  });

  test("retriever run_type mapped to type=retrieval", () => {
    expect(trace.steps[3].type).toBe("retrieval");
    expect(trace.steps[3].name).toBe("VectorStoreRetriever");
  });

  test("run with error field mapped to status=error", () => {
    const errStep = trace.steps[4];
    expect(errStep.name).toBe("broken_tool");
    expect(errStep.status).toBe("error");
  });

  test("run with no outputs (but no error) mapped to status=error", () => {
    // outputs: undefined and no error
    const step = trace.steps[4];
    expect(step.status).toBe("error");
  });

  test("duration computed from ISO timestamps", () => {
    const root = trace.steps[0];
    expect(root.durationMs).toBe(10000);
  });

  test("inputs and outputs preserved", () => {
    const tool = trace.steps[2];
    expect(tool.input).toEqual({ city: "London" });
    expect(tool.output).toEqual({ output: "15°C, cloudy" });
  });

  test("raw preserved on trace", () => {
    expect(trace.raw).toBe(langChainRun);
  });
});

// ── parseTrace generic entry point ────────────────────────────────────────────

describe("parseTrace", () => {
  test("dispatches to normaliseOpenAI for provider=openai", () => {
    const trace = parseTrace("openai", openAISteps);
    expect(trace.provider).toBe("openai");
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  test("dispatches to normaliseLangChain for provider=langchain", () => {
    const trace = parseTrace("langchain", langChainRun);
    expect(trace.provider).toBe("langchain");
    expect(trace.steps.length).toBeGreaterThan(0);
  });

  test("throws on unknown provider", () => {
    expect(() => parseTrace("unknown" as never, {})).toThrow(/unknown provider/);
  });
});

// ── Schema consistency ────────────────────────────────────────────────────────

describe("schema consistency — same assertions work across providers", () => {
  test("both traces have tool steps with name, input, output, status", () => {
    const oai  = normaliseOpenAI(openAISteps as never);
    const lc   = normaliseLangChain(langChainRun as never);

    const toolSteps = (t: AgentTrace) => t.steps.filter(s => s.type === "tool");

    for (const step of [...toolSteps(oai), ...toolSteps(lc)]) {
      expect(step.type).toBe("tool");
      expect(typeof step.name).toBe("string");
      expect(["success", "error", "cancelled"]).toContain(step.status);
    }
  });

  test("tool names are extractable from both providers for assertion", () => {
    const oai  = normaliseOpenAI(openAISteps as never);
    const lc   = normaliseLangChain(langChainRun as never);
    const toolNames = (t: AgentTrace) => t.steps.filter(s => s.type === "tool").map(s => s.name);

    expect(toolNames(oai)).toContain("get_weather");
    expect(toolNames(lc)).toContain("get_weather");
  });
});
