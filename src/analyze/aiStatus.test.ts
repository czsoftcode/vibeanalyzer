import { describe, expect, it } from "vitest";
import { AI_KEY_ENV, AI_MISSING_KEY_REASON, type AiStatus, detectAiStatus } from "./aiStatus.js";

describe("detectAiStatus – brána AI vrstvy", () => {
  it("chybějící klíč → skipped s důvodem 'chybí ANTHROPIC_API_KEY'", () => {
    const status = detectAiStatus({});
    expect(status).toEqual<AiStatus>({ kind: "skipped", reason: AI_MISSING_KEY_REASON });
    expect(status.kind === "skipped" && status.reason).toBe("chybí ANTHROPIC_API_KEY");
  });

  it("prázdný klíč ('') → skipped (ne ready)", () => {
    const status = detectAiStatus({ [AI_KEY_ENV]: "" });
    expect(status).toEqual<AiStatus>({ kind: "skipped", reason: AI_MISSING_KEY_REASON });
  });

  it("klíč jen z whitespace → skipped (trim, ne falešné ready)", () => {
    const status = detectAiStatus({ [AI_KEY_ENV]: "   \t\n " });
    expect(status.kind).toBe("skipped");
  });

  it("neprázdný klíč → ready (žádný jiný klíč detekci neovlivní)", () => {
    const status = detectAiStatus({ [AI_KEY_ENV]: "sk-ant-xxx", OTHER: "y" });
    expect(status).toEqual<AiStatus>({ kind: "ready" });
  });

  it("ready NIKDY nenese hodnotu klíče (tajemství se nesmí dostat dál)", () => {
    const status = detectAiStatus({ [AI_KEY_ENV]: "sk-ant-super-secret" });
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });
});
