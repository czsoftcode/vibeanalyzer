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

import {
  AI_ANALYZE_MAX_RETRIES,
  AI_ANALYZE_TIMEOUT_MS,
  buildAnalyzeClientOptions,
  realAiAnalyze,
} from "./aiAnalyze.js";
import { AI_PROVIDERS } from "./aiStatus.js";

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

// Schéma je povinný 5. parametr realAiAnalyze (injektuje ho volající podle režimu).
// Tyto testy jeho obsah nepozorují (to dělá cli.ai.test.ts přes reálný builder), ale
// signatura ho vyžaduje – posíláme zástupné.
const SCHEMA = { type: "object", properties: {} };

describe("realAiAnalyze – streaming SDK volání (mock, bez sítě)", () => {
  it("streamuje a z finalMessage vytáhne JSON text + usage; klient maxRetries:0 + velký timeout", async () => {
    fakeFinal({
      content: [{ type: "thinking", thinking: "…" }, { type: "text", text: '{"findings":[]}' }],
      usage: { input_tokens: 111, output_tokens: 22 },
    });
    const out = await realAiAnalyze("sk-ant-key", "opus", "SYS", "PROMPT", SCHEMA);
    expect(out.rawText).toBe('{"findings":[]}');
    expect(out.usage).toEqual({ inputTokens: 111, outputTokens: 22 });
    expect(out.stopReason).toBe("end_turn");
    expect(ctorMock).toHaveBeenCalledWith({ apiKey: "sk-ant-key", maxRetries: 0, timeout: AI_ANALYZE_TIMEOUT_MS });

    const params = streamMock.mock.calls[0]?.[0] as {
      model: string;
      max_tokens: number;
      thinking: unknown;
      reasoning_effort?: unknown;
      output_config: { format: { type: string } };
      system: string;
    };
    expect(params.model).toBe("claude-opus-4-8");
    // Anthropic model: 16k strop + adaptive thinking, ŽÁDNÝ reasoning_effort (Z.ai-only pole).
    expect(params.max_tokens).toBe(16000);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect("reasoning_effort" in params).toBe(false);
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.system).toBe("SYS");
  });

  it("model 'sonnet' → claude-sonnet-4-6; input_tokens null → 0", async () => {
    fakeFinal({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: null, output_tokens: 5 } });
    const out = await realAiAnalyze("k", "sonnet", "s", "p", SCHEMA);
    expect(streamMock.mock.calls[0]?.[0].model).toBe("claude-sonnet-4-6");
    expect(out.usage.inputTokens).toBe(0);
  });

  it("žádný textový blok → rawText prázdný (parse pak selže výš, ne tady)", async () => {
    fakeFinal({ content: [{ type: "thinking", thinking: "x" }], usage: { input_tokens: 1, output_tokens: 1 } });
    expect((await realAiAnalyze("k", "opus", "s", "p", SCHEMA)).rawText).toBe("");
  });

  it("propaguje stop_reason (max_tokens) výš – uříznutí řeší runAiAnalysis, ne tady", async () => {
    fakeFinal({ content: [{ type: "text", text: "" }], usage: { input_tokens: 9, output_tokens: 16000 }, stop_reason: "max_tokens" });
    const out = await realAiAnalyze("k", "sonnet", "s", "p", SCHEMA);
    expect(out.stopReason).toBe("max_tokens");
    expect(out.rawText).toBe(""); // tady NEpadáme na prázdném JSON
  });

  it("chyba z finalMessage probublá (NEodchytává se tady)", async () => {
    streamMock.mockReturnValue({ finalMessage: () => Promise.reject(new Error("ECONNRESET")) });
    await expect(realAiAnalyze("k", "opus", "s", "p", SCHEMA)).rejects.toThrow("ECONNRESET");
  });

  it("konstanty: žádný retry, prakticky neomezený timeout (pojistka)", () => {
    expect(AI_ANALYZE_MAX_RETRIES).toBe(0);
    expect(AI_ANALYZE_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
  });

  it("model 'glm' → glm-5.2 + klient na Z.ai baseURL", async () => {
    fakeFinal({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } });
    await realAiAnalyze("zai-key", "glm", "s", "p", SCHEMA);
    expect(streamMock.mock.calls[0]?.[0].model).toBe("glm-5.2");
    expect(ctorMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "zai-key", baseURL: "https://api.z.ai/api/anthropic" }),
    );
  });

  it("glm posílá per-model tvar: 128k strop + enabled thinking + reasoning_effort high", async () => {
    // Zub proti regresi root-cause fixu: kdyby glm zdědil plošný 16k/adaptive jako Anthropic
    // (default reasoning_effort=max), výstup se zase uřízne. Tady to hlídáme konkrétními hodnotami.
    fakeFinal({ content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 1 } });
    await realAiAnalyze("zai-key", "glm", "s", "p", SCHEMA);
    const params = streamMock.mock.calls[0]?.[0] as {
      max_tokens: number;
      thinking: unknown;
      reasoning_effort?: unknown;
    };
    expect(params.max_tokens).toBe(131072);
    expect(params.thinking).toEqual({ type: "enabled" });
    expect(params.reasoning_effort).toBe("high");
  });

  it("per-model rozdíl: glm má jiný strop/thinking/effort než Anthropic modely", () => {
    // Kontrakt přímo nad AI_PROVIDERS – záměna hodnot mezi modely shodí test.
    expect(AI_PROVIDERS.glm.maxTokens).not.toBe(AI_PROVIDERS.opus.maxTokens);
    expect(AI_PROVIDERS.glm.thinking).toEqual({ type: "enabled" });
    expect(AI_PROVIDERS.opus.thinking).toEqual({ type: "adaptive" });
    expect(AI_PROVIDERS.sonnet.thinking).toEqual({ type: "adaptive" });
    expect(AI_PROVIDERS.glm.reasoningEffort).toBe("high");
    // Anthropic modely NESMÍ nést reasoning_effort (Z.ai-only pole).
    expect(AI_PROVIDERS.opus.reasoningEffort).toBeUndefined();
    expect(AI_PROVIDERS.sonnet.reasoningEffort).toBeUndefined();
  });
});

describe("buildAnalyzeClientOptions – endpoint dle modelu (bez sítě)", () => {
  it("glm → baseURL Z.ai Anthropic-kompatibilní endpoint", () => {
    expect(buildAnalyzeClientOptions("zai-x", "glm").baseURL).toBe("https://api.z.ai/api/anthropic");
  });

  it("opus/sonnet → baseURL nenastaven (SDK použije default Anthropic)", () => {
    // Zub: kdyby se baseURL nastavoval i pro Anthropic modely, opus by netrefil default.
    expect(buildAnalyzeClientOptions("k", "opus").baseURL).toBeUndefined();
    expect(buildAnalyzeClientOptions("k", "sonnet").baseURL).toBeUndefined();
  });

  it("nese apiKey, žádný retry, velký timeout", () => {
    const o = buildAnalyzeClientOptions("secret-key", "glm");
    expect(o.apiKey).toBe("secret-key");
    expect(o.maxRetries).toBe(AI_ANALYZE_MAX_RETRIES);
    expect(o.timeout).toBe(AI_ANALYZE_TIMEOUT_MS);
  });
});
