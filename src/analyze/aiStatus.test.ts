import { describe, expect, it, vi } from "vitest";
import {
  AI_KEY_ENV,
  AI_MISSING_KEY_REASON,
  AI_PROVIDERS,
  type AiStatus,
  describeTruncation,
  detectAiStatus,
  formatBytes,
  verifyAiAccess,
} from "./aiStatus.js";

describe("formatBytes – lidská velikost (B/kB/MB)", () => {
  it("pod 1 kB → bajty", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  it("kB se zaokrouhlí na celé", () => {
    expect(formatBytes(1024)).toBe("1 kB");
    expect(formatBytes(635_000)).toBe("620 kB"); // 620,1 → 620
  });
  it("od 1 MB výš na jedno desetinné", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1_650_000)).toBe("1.6 MB");
  });
});

describe("describeTruncation – sdílená věta (report i stderr)", () => {
  it("nese počet viděných z celku, vynechané soubory i velikost", () => {
    const s = describeTruncation({ includedFiles: 18, omittedFiles: 7, omittedBytes: 635_000 });
    expect(s).toContain("AI viděla 18 z 25 zdrojových souborů");
    expect(s).toContain("7 souborů");
    expect(s).toContain("620 kB");
    expect(s).toContain("posouzení je neúplné");
  });
});

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

describe("AI_PROVIDERS – jeden zdroj pravdy (id/endpoint/klíč/ceny)", () => {
  it("pokrývá přesně tři modely", () => {
    expect(Object.keys(AI_PROVIDERS).sort()).toEqual(["glm", "opus", "sonnet"]);
  });

  it("glm = GLM-5.2 přes Anthropic-kompatibilní endpoint Z.ai se ZAI_API_KEY", () => {
    expect(AI_PROVIDERS.glm).toEqual({
      modelId: "glm-5.2",
      baseURL: "https://api.z.ai/api/anthropic",
      keyEnv: "ZAI_API_KEY",
      prices: { input: 1.4, output: 4.4 },
      maxTokens: 65536,
      thinking: { type: "enabled" },
      reasoningEffort: "low",
    });
  });

  it("opus/sonnet jedou na default Anthropic endpoint (baseURL nenastaven) s ANTHROPIC_API_KEY", () => {
    expect(AI_PROVIDERS.opus.baseURL).toBeUndefined();
    expect(AI_PROVIDERS.sonnet.baseURL).toBeUndefined();
    expect(AI_PROVIDERS.opus.keyEnv).toBe("ANTHROPIC_API_KEY");
    expect(AI_PROVIDERS.sonnet.keyEnv).toBe("ANTHROPIC_API_KEY");
  });
});

describe("detectAiStatus – model-aware brána (klíč dle providera)", () => {
  it("glm gatuje na ZAI_API_KEY: jen ANTHROPIC nastavený → SKIPPED (ne ready)", () => {
    // Zub: kdyby detectAiStatus ignorovalo model a četlo ANTHROPIC, vyšlo by ready.
    const status = detectAiStatus({ [AI_KEY_ENV]: "sk-ant-x" }, "glm");
    expect(status.kind).toBe("skipped");
    expect(status.kind === "skipped" && status.reason).toContain("chybí ZAI_API_KEY");
  });

  it("glm + ZAI_API_KEY nastavený → ready", () => {
    const status = detectAiStatus({ ZAI_API_KEY: "zai-secret" }, "glm");
    expect(status).toEqual<AiStatus>({ kind: "ready" });
  });

  it("opus gatuje na ANTHROPIC_API_KEY: jen ZAI nastavený → SKIPPED", () => {
    const status = detectAiStatus({ ZAI_API_KEY: "zai-x" }, "opus");
    expect(status.kind).toBe("skipped");
    expect(status.kind === "skipped" && status.reason).toContain("chybí ANTHROPIC_API_KEY");
  });

  it("default model (bez argumentu) = opus → původní kontrakt 'chybí ANTHROPIC_API_KEY'", () => {
    expect(detectAiStatus({})).toEqual<AiStatus>({ kind: "skipped", reason: AI_MISSING_KEY_REASON });
  });
});

describe("detectAiStatus – nápověda na klíč jiného providera", () => {
  it("opus vybrán, chybí ANTHROPIC, ale je ZAI → reason napoví --ai-model=glm", () => {
    const status = detectAiStatus({ ZAI_API_KEY: "zai-x" }, "opus");
    expect(status.kind).toBe("skipped");
    const reason = status.kind === "skipped" ? status.reason : "";
    expect(reason).toContain("chybí ANTHROPIC_API_KEY");
    expect(reason).toContain("nalezen ZAI_API_KEY");
    expect(reason).toContain("--ai-model=glm");
  });

  it("glm vybrán, chybí ZAI, ale je ANTHROPIC → reason napoví přepnutí na opus/sonnet", () => {
    const status = detectAiStatus({ [AI_KEY_ENV]: "sk-ant-x" }, "glm");
    const reason = status.kind === "skipped" ? status.reason : "";
    expect(reason).toContain("nalezen ANTHROPIC_API_KEY");
    expect(reason).toMatch(/--ai-model=(opus|sonnet)/);
  });

  it("oba klíče chybí → čistý důvod BEZ nápovědy (nemate, když není co navrhnout)", () => {
    const status = detectAiStatus({}, "glm");
    expect(status).toEqual<AiStatus>({ kind: "skipped", reason: "chybí ZAI_API_KEY" });
  });

  it("nápověda NIKDY nenese hodnotu cizího klíče (tajemství)", () => {
    const status = detectAiStatus({ ZAI_API_KEY: "zai-super-secret" }, "opus");
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

  it("--ai-check je Anthropic-only: ZAI nastaven, ANTHROPIC chybí → SKIPPED bez glm nápovědy", async () => {
    // Zub: ping nesmí navrhovat glm. reason musí zůstat PŘESNĚ AI_MISSING_KEY_REASON
    // (cli na tu rovnost spoléhá) a ping se nesmí zavolat.
    const ping = vi.fn(async () => {});
    const status = await verifyAiAccess({ ZAI_API_KEY: "zai-x" }, ping, classifyAllKnown);
    expect(status).toEqual<AiStatus>({ kind: "skipped", reason: AI_MISSING_KEY_REASON });
    expect(status.kind === "skipped" && status.reason).not.toContain("--ai-model");
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
