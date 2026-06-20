import { beforeEach, describe, expect, it, vi } from "vitest";

// Zuby pro realAiPing: tvar volání SDK (model, max_tokens, maxRetries:0, timeout)
// a fakt, že chybu z create NEodchytává (nechá ji probublat ke classifyAiError).
// SDK MOCKUJEME – žádná síť, žádné útraty. Reálné instanceof chybové třídy testuje
// aiPing.test.ts (ten SDK nemockuje); tady classifyAiError nevoláme, takže absence
// statických chybových tříd na mocku nevadí.
const { createMock, ctorMock } = vi.hoisted(() => ({ createMock: vi.fn(), ctorMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
    constructor(opts: unknown) {
      ctorMock(opts);
    }
  },
}));

import { AI_MODEL, AI_PING_TIMEOUT_MS, realAiPing } from "./aiPing.js";

beforeEach(() => {
  createMock.mockReset();
  ctorMock.mockReset();
});

describe("realAiPing – tvar SDK volání (mock SDK, bez sítě)", () => {
  it("klient: apiKey, maxRetries:0 a timeout v ms (rychlé selhání, ne retry×3)", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    await realAiPing("sk-ant-key");
    expect(ctorMock).toHaveBeenCalledWith({
      apiKey: "sk-ant-key",
      maxRetries: 0,
      timeout: AI_PING_TIMEOUT_MS,
    });
  });

  it("dotaz: levný model a malé max_tokens (jeden zpráva)", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    await realAiPing("k");
    const payload = createMock.mock.calls[0]?.[0] as {
      model: string;
      max_tokens: number;
      messages: unknown[];
    };
    expect(payload.model).toBe(AI_MODEL);
    expect(payload.model).toBe("claude-haiku-4-5");
    expect(payload.max_tokens).toBe(16);
    expect(Array.isArray(payload.messages)).toBe(true);
    expect(payload.messages).toHaveLength(1);
  });

  it("chybu z create NEodchytává – probublá (úzký catch je až ve verifyAiAccess)", async () => {
    const boom = new Error("ECONNREFUSED");
    createMock.mockRejectedValue(boom);
    await expect(realAiPing("k")).rejects.toBe(boom);
  });
});
