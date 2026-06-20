import { describe, expect, it, vi } from "vitest";
import {
  AI_KEY_ENV,
  AI_MISSING_KEY_REASON,
  type AiStatus,
  detectAiStatus,
  verifyAiAccess,
} from "./aiStatus.js";

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

describe("verifyAiAccess – reálné ověření (--ai-check), ping/classify injektované", () => {
  // classify, který každou chybu pokládá za známou (síťovou); rethrow testujeme zvlášť.
  const classifyAllKnown = () => "síťová chyba";
  // classify, který NIC nezná → vše je „nečekané" a musí probublat.
  const classifyNone = () => null;

  it("chybějící klíč → skipped (ping se VŮBEC nezavolá – žádná síť, žádné útraty)", async () => {
    const ping = vi.fn(async () => {});
    const status = await verifyAiAccess({}, ping, classifyAllKnown);
    expect(status).toEqual<AiStatus>({ kind: "skipped", reason: AI_MISSING_KEY_REASON });
    expect(ping).not.toHaveBeenCalled();
  });

  it("klíč + ping resolve → verified", async () => {
    const ping = vi.fn(async () => {});
    const status = await verifyAiAccess({ [AI_KEY_ENV]: "sk-ant-x" }, ping, classifyNone);
    expect(status).toEqual<AiStatus>({ kind: "verified" });
    expect(ping).toHaveBeenCalledOnce();
  });

  it("ping dostane TRIMnutý klíč, ale ten se NIKDY neobjeví v návratu", async () => {
    const seen: string[] = [];
    const ping = vi.fn(async (k: string) => {
      seen.push(k);
    });
    const status = await verifyAiAccess({ [AI_KEY_ENV]: "  sk-ant-super-secret \n" }, ping, classifyNone);
    expect(seen).toEqual(["sk-ant-super-secret"]); // trim proběhl
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });

  it("ping reject + classify ZNÁ chybu → skipped s tím důvodem (síť/timeout/401)", async () => {
    const ping = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const status = await verifyAiAccess({ [AI_KEY_ENV]: "sk-ant-x" }, ping, classifyAllKnown);
    expect(status).toEqual<AiStatus>({ kind: "skipped", reason: "síťová chyba" });
  });

  it("ping reject + classify NEzná chybu (null) → probublá se stackem (ne tiché skipped)", async () => {
    const boom = new TypeError("cannot read x of undefined");
    const ping = vi.fn(async () => {
      throw boom;
    });
    await expect(verifyAiAccess({ [AI_KEY_ENV]: "sk-ant-x" }, ping, classifyNone)).rejects.toBe(boom);
  });
});
