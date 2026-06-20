import { beforeEach, describe, expect, it, vi } from "vitest";

// Zuby pro realAiAnalyze: tvar SDK volání (streaming přes messages.stream().finalMessage(),
// model/max_tokens/thinking/output_config, klient maxRetries:0 + velký timeout) a extrakce
// rawText/usage. SDK MOCKUJEME – žádná síť, žádné útraty.
const { streamMock, ctorMock } = vi.hoisted(() => ({ streamMock: vi.fn(), ctorMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
    constructor(opts: unknown) {
      ctorMock(opts);
    }
  },
}));

import { AI_ANALYZE_MAX_RETRIES, AI_ANALYZE_MAX_TOKENS, AI_ANALYZE_TIMEOUT_MS, realAiAnalyze } from "./aiAnalyze.js";

type FakeMsg = {
  content: { type: string; text?: string; thinking?: string }[];
  usage: { input_tokens: number | null; output_tokens: number };
  stop_reason?: string | null;
};
function fakeFinal(msg: FakeMsg): void {
  streamMock.mockReturnValue({ finalMessage: () => Promise.resolve({ stop_reason: "end_turn", ...msg }) });
}

beforeEach(() => {
  streamMock.mockReset();
  ctorMock.mockReset();
});

describe("realAiAnalyze – streaming SDK volání (mock, bez sítě)", () => {
  it("streamuje a z finalMessage vytáhne JSON text + usage; klient maxRetries:0 + velký timeout", async () => {
    fakeFinal({
      content: [{ type: "thinking", thinking: "…" }, { type: "text", text: '{"findings":[]}' }],
      usage: { input_tokens: 111, output_tokens: 22 },
    });
    const out = await realAiAnalyze("sk-ant-key", "opus", "SYS", "PROMPT");
    expect(out.rawText).toBe('{"findings":[]}');
    expect(out.usage).toEqual({ inputTokens: 111, outputTokens: 22 });
    expect(out.stopReason).toBe("end_turn");
    expect(ctorMock).toHaveBeenCalledWith({ apiKey: "sk-ant-key", maxRetries: 0, timeout: AI_ANALYZE_TIMEOUT_MS });

    const params = streamMock.mock.calls[0]?.[0] as {
      model: string;
      max_tokens: number;
      thinking: unknown;
      output_config: { format: { type: string } };
      system: string;
    };
    expect(params.model).toBe("claude-opus-4-8");
    expect(params.max_tokens).toBe(AI_ANALYZE_MAX_TOKENS);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.system).toBe("SYS");
  });

  it("model 'sonnet' → claude-sonnet-4-6; input_tokens null → 0", async () => {
    fakeFinal({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: null, output_tokens: 5 } });
    const out = await realAiAnalyze("k", "sonnet", "s", "p");
    expect(streamMock.mock.calls[0]?.[0].model).toBe("claude-sonnet-4-6");
    expect(out.usage.inputTokens).toBe(0);
  });

  it("žádný textový blok → rawText prázdný (parse pak selže výš, ne tady)", async () => {
    fakeFinal({ content: [{ type: "thinking", thinking: "x" }], usage: { input_tokens: 1, output_tokens: 1 } });
    expect((await realAiAnalyze("k", "opus", "s", "p")).rawText).toBe("");
  });

  it("propaguje stop_reason (max_tokens) výš – uříznutí řeší runAiAnalysis, ne tady", async () => {
    fakeFinal({ content: [{ type: "text", text: "" }], usage: { input_tokens: 9, output_tokens: 16000 }, stop_reason: "max_tokens" });
    const out = await realAiAnalyze("k", "sonnet", "s", "p");
    expect(out.stopReason).toBe("max_tokens");
    expect(out.rawText).toBe(""); // tady NEpadáme na prázdném JSON
  });

  it("chyba z finalMessage probublá (NEodchytává se tady)", async () => {
    streamMock.mockReturnValue({ finalMessage: () => Promise.reject(new Error("ECONNRESET")) });
    await expect(realAiAnalyze("k", "opus", "s", "p")).rejects.toThrow("ECONNRESET");
  });

  it("konstanty: žádný retry, prakticky neomezený timeout (pojistka)", () => {
    expect(AI_ANALYZE_MAX_RETRIES).toBe(0);
    expect(AI_ANALYZE_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
  });
});
