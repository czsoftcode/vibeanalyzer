import { describe, expect, it, vi } from "vitest";
import type { Intent } from "../intent.js";
import { AI_KEY_ENV, type AiUsage } from "./aiStatus.js";
import type { AiPayload } from "./aiPayload.js";
import {
  type AnalyzeFn,
  buildAnalyzePrompt,
  buildCodePrompt,
  buildLogicPrompt,
  CODE_FINDINGS_SCHEMA,
  computeCostUsd,
  LOGIC_FINDINGS_SCHEMA,
  parseCodeFindings,
  parseFindings,
  parseLogicFindings,
  runAiAnalysis,
  runAiCodeAnalysis,
  runAiLogicAnalysis,
  toCodeFindings,
  toFindings,
  toLogicFindings,
} from "./aiResult.js";

const payload: AiPayload = {
  text: "// ==== a.ts ====\nexport const x = 1;\n",
  includedFiles: [{ path: "a.ts", lineCount: 1 }],
  truncated: false,
  oversizedFiles: [],
};

function intentWith(nonGoals: string[] | null, building: string | null = "Stavím CLI"): Intent {
  return { building, nonGoals, sourcePath: "/p/project.md" };
}

describe("buildAnalyzePrompt", () => {
  it("obsahuje záměr, číslované non-goaly i kód", () => {
    const p = buildAnalyzePrompt("Stavím CLI", ["Nespouštět kód", "Žádný web"], payload);
    expect(p).toContain("Stavím CLI");
    expect(p).toContain("0: Nespouštět kód");
    expect(p).toContain("1: Žádný web");
    expect(p).toContain("export const x = 1;");
  });

  it("při uříznutí přidá varování o neúplnosti", () => {
    const p = buildAnalyzePrompt(null, ["x"], { ...payload, truncated: true });
    expect(p).toContain("uříznut");
  });
});

describe("parseFindings", () => {
  it("naparsuje validní JSON na pole nálezů", () => {
    const raw = JSON.stringify({
      findings: [{ file: "a.ts", line: 1, nonGoalIndex: 0, severity: "error", message: "x" }],
    });
    expect(parseFindings(raw)).toEqual([
      { file: "a.ts", line: 1, nonGoalIndex: 0, severity: "error", message: "x" },
    ]);
  });

  it("prázdný seznam je validní", () => {
    expect(parseFindings(JSON.stringify({ findings: [] }))).toEqual([]);
  });

  it("nevalidní JSON HODÍ (nemaskovat jako prázdno)", () => {
    expect(() => parseFindings("toto není json")).toThrow();
  });

  it("špatný tvar (chybí findings) HODÍ", () => {
    expect(() => parseFindings(JSON.stringify({ neco: 1 }))).toThrow();
  });

  it("nález se špatným polem (line není číslo) HODÍ", () => {
    const raw = JSON.stringify({ findings: [{ file: "a.ts", line: "x", nonGoalIndex: 0, severity: "error", message: "m" }] });
    expect(() => parseFindings(raw)).toThrow();
  });
});

describe("toFindings – mapování + levná kontrola místa", () => {
  const nonGoals = ["Nespouštět kód", "Žádný web"];
  const included = [{ path: "a.ts", lineCount: 10 }];

  it("ověřené místo (soubor v setu, řádek v rozsahu) → file+line zůstanou, rule nese non-goal", () => {
    const f = toFindings([{ file: "a.ts", line: 5, nonGoalIndex: 0, severity: "error", message: "spouští kód" }], nonGoals, included);
    expect(f[0]).toEqual({
      source: "ai",
      severity: "error",
      file: "a.ts",
      line: 5,
      rule: "non-goal: Nespouštět kód",
      message: "spouští kód",
    });
  });

  it("soubor mimo poslaný set → file/line zahozeny, zpráva označí 'místo neověřeno'", () => {
    const f = toFindings([{ file: "cizi.ts", line: 3, nonGoalIndex: 1, severity: "warning", message: "x" }], nonGoals, included);
    expect(f[0].file).toBeUndefined();
    expect(f[0].line).toBeUndefined();
    expect(f[0].message).toContain("místo neověřeno");
    expect(f[0].message).toContain("cizi.ts");
  });

  it("řádek mimo soubor (> lineCount) → file zůstane, line zahozen, 'místo neověřeno'", () => {
    const f = toFindings([{ file: "a.ts", line: 999, nonGoalIndex: 0, severity: "info", message: "x" }], nonGoals, included);
    expect(f[0].file).toBe("a.ts");
    expect(f[0].line).toBeUndefined();
    expect(f[0].message).toContain("řádek 999");
  });

  it("nonGoalIndex mimo seznam → rule to přizná, nespadne", () => {
    const f = toFindings([{ file: "a.ts", line: 1, nonGoalIndex: 9, severity: "error", message: "x" }], nonGoals, included);
    expect(f[0].rule).toContain("mimo seznam");
  });
});

describe("computeCostUsd – cena ze skutečné usage", () => {
  const usage: AiUsage = { inputTokens: 1_000_000, outputTokens: 200_000 };
  it("opus: 1M vstup × $5 + 0,2M výstup × $25 = $10", () => {
    expect(computeCostUsd(usage, "opus")).toBeCloseTo(5 + 5, 6); // 5 + (0.2*25=5)
  });
  it("sonnet: 1M vstup × $3 + 0,2M výstup × $15 = $6", () => {
    expect(computeCostUsd(usage, "sonnet")).toBeCloseTo(3 + 3, 6); // 3 + (0.2*15=3)
  });
  it("glm: 1M vstup × $1,4 + 0,2M výstup × $4,4 = $2,28 (výrazně levnější)", () => {
    expect(computeCostUsd(usage, "glm")).toBeCloseTo(1.4 + 0.88, 6); // 1.4 + (0.2*4.4=0.88)
  });
});

describe("runAiAnalysis – orchestrátor (analyze/classify injektované, bez sítě)", () => {
  const okAnalyze: AnalyzeFn = async () => ({
    rawText: JSON.stringify({ findings: [{ file: "a.ts", line: 1, nonGoalIndex: 0, severity: "error", message: "porušuje" }] }),
    usage: { inputTokens: 1000, outputTokens: 100 },
    stopReason: "end_turn",
  });
  const classifyNet = () => "síťová chyba";
  const classifyNone = () => null;

  it("chybějící klíč → skipped, analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiAnalysis({}, intentWith(["x"]), payload, "opus", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("žádné non-goaly → skipped (není co posuzovat), analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null), payload, "opus", analyze, classifyNone);
    expect(ai).toMatchObject({ kind: "skipped" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("žádné soubory → skipped", async () => {
    const ai = await runAiAnalysis(
      { [AI_KEY_ENV]: "k" },
      intentWith(["x"]),
      { text: "", includedFiles: [], truncated: false, oversizedFiles: [] },
      "opus",
      vi.fn(okAnalyze),
      classifyNone,
    );
    expect(ai).toMatchObject({ kind: "skipped" });
  });

  it("úspěch → analyzed s nálezy, usage a spočítanou cenou", async () => {
    const ai = await runAiAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(["Nespouštět kód"]), payload, "opus", okAnalyze, classifyNone);
    expect(ai.kind).toBe("analyzed");
    if (ai.kind === "analyzed") {
      expect(ai.model).toBe("opus");
      expect(ai.findings).toHaveLength(1);
      expect(ai.findings[0].rule).toBe("non-goal: Nespouštět kód");
      expect(ai.usage).toEqual<AiUsage>({ inputTokens: 1000, outputTokens: 100 });
      expect(ai.costUsd).toBeGreaterThan(0);
    }
  });

  it("síťová chyba (classify ji zná) → skipped s důvodem", async () => {
    const analyze: AnalyzeFn = async () => {
      throw new Error("ECONNRESET");
    };
    const ai = await runAiAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(["x"]), payload, "opus", analyze, classifyNet);
    expect(ai).toEqual({ kind: "skipped", reason: "síťová chyba" });
  });

  it("nečekaná chyba (špatný tvar odpovědi s end_turn, classify→null) → probublá se stackem", async () => {
    const analyze: AnalyzeFn = async () => ({ rawText: "rozbitý json", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" });
    await expect(
      runAiAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(["x"]), payload, "opus", analyze, classifyNone),
    ).rejects.toThrow();
  });

  it("uříznutý výstup (stop_reason=max_tokens) → čistý skip s důvodem a cenou, NE pád na JSON", async () => {
    // přesně reálný sonnet bug: thinking sežral max_tokens, JSON prázdný/uříznutý
    const analyze: AnalyzeFn = async () => ({ rawText: "", usage: { inputTokens: 70000, outputTokens: 16000 }, stopReason: "max_tokens" });
    const ai = await runAiAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(["x"]), payload, "sonnet", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    if (ai.kind === "skipped") {
      expect(ai.reason).toContain("max_tokens");
      expect(ai.reason).toContain("$"); // naúčtovaná cena je v důvodu (transparentnost)
    }
  });

  it("prázdný výstup i s end_turn → čistý skip (ne pád na JSON.parse(''))", async () => {
    const analyze: AnalyzeFn = async () => ({ rawText: "   ", usage: { inputTokens: 10, outputTokens: 0 }, stopReason: "end_turn" });
    const ai = await runAiAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(["x"]), payload, "opus", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
  });

  it("klíč se NIKDY neobjeví v návratu (tajemství)", async () => {
    const ai = await runAiAnalysis({ [AI_KEY_ENV]: "sk-ant-super-secret" }, intentWith(["x"]), payload, "opus", okAnalyze, classifyNone);
    expect(JSON.stringify(ai)).not.toContain("super-secret");
  });

  it("předá NON-GOAL schéma (s nonGoalIndex, bez kind) – kontrakt prompt↔schéma", async () => {
    const analyze = vi.fn(okAnalyze);
    await runAiAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(["x"]), payload, "opus", analyze, classifyNone);
    const schema = analyze.mock.calls[0]?.[4] as { properties: { findings: { items: { properties: Record<string, unknown> } } } };
    expect(schema.properties.findings.items.properties.nonGoalIndex).toBeDefined();
    expect(schema.properties.findings.items.properties.kind).toBeUndefined();
  });
});

// ---- analýza kódu (--ai-code) -------------------------------------------------------

describe("CODE_FINDINGS_SCHEMA", () => {
  it("NEobsahuje nonGoalIndex (code se neváže na non-goaly), místo toho má kind", () => {
    const props = (CODE_FINDINGS_SCHEMA.properties as { findings: { items: { properties: Record<string, unknown>; required: string[] } } })
      .findings.items;
    expect(props.properties.nonGoalIndex).toBeUndefined();
    expect(props.properties.kind).toBeDefined();
    expect(props.required).toContain("kind");
    expect(props.required).not.toContain("nonGoalIndex");
  });
});

describe("buildCodePrompt", () => {
  it("obsahuje kód, ale NE záměr/non-goaly (code je posuzuje nezávisle)", () => {
    const p = buildCodePrompt(payload);
    expect(p).toContain("export const x = 1;");
    expect(p).not.toContain("Deklarované non-goaly");
  });

  it("při uříznutí přidá varování o neúplnosti", () => {
    expect(buildCodePrompt({ ...payload, truncated: true })).toContain("uříznut");
  });
});

describe("parseCodeFindings", () => {
  it("naparsuje validní JSON (s kind, bez nonGoalIndex)", () => {
    const raw = JSON.stringify({ findings: [{ file: "a.ts", line: 1, kind: "logická chyba", severity: "warning", message: "m" }] });
    expect(parseCodeFindings(raw)).toEqual([{ file: "a.ts", line: 1, kind: "logická chyba", severity: "warning", message: "m" }]);
  });

  it("prázdný seznam je validní", () => {
    expect(parseCodeFindings(JSON.stringify({ findings: [] }))).toEqual([]);
  });

  it("nevalidní JSON HODÍ (nemaskovat jako prázdno)", () => {
    expect(() => parseCodeFindings("není json")).toThrow();
  });

  it("chybějící kind HODÍ", () => {
    const raw = JSON.stringify({ findings: [{ file: "a.ts", line: 1, severity: "warning", message: "m" }] });
    expect(() => parseCodeFindings(raw)).toThrow();
  });
});

describe("toCodeFindings – mapování + kontrola místa (bez vazby na non-goal)", () => {
  const included = [{ path: "a.ts", lineCount: 10 }];

  it("ověřené místo → file+line zůstanou, rule nese druh problému", () => {
    const f = toCodeFindings([{ file: "a.ts", line: 5, kind: "logická chyba", severity: "warning", message: "off-by-one" }], included);
    expect(f[0]).toEqual({ source: "ai", severity: "warning", file: "a.ts", line: 5, rule: "kód: logická chyba", message: "off-by-one" });
  });

  it("soubor mimo poslaný set → file/line zahozeny, 'místo neověřeno'", () => {
    const f = toCodeFindings([{ file: "cizi.ts", line: 3, kind: "x", severity: "info", message: "m" }], included);
    expect(f[0].file).toBeUndefined();
    expect(f[0].line).toBeUndefined();
    expect(f[0].message).toContain("místo neověřeno");
  });

  it("řádek mimo soubor → file zůstane, line zahozen", () => {
    const f = toCodeFindings([{ file: "a.ts", line: 999, kind: "x", severity: "info", message: "m" }], included);
    expect(f[0].file).toBe("a.ts");
    expect(f[0].line).toBeUndefined();
    expect(f[0].message).toContain("řádek 999");
  });
});

describe("runAiCodeAnalysis – orchestrátor (analyze/classify injektované)", () => {
  const okAnalyze: AnalyzeFn = async () => ({
    rawText: JSON.stringify({ findings: [{ file: "a.ts", line: 1, kind: "riskantní vzorec", severity: "warning", message: "nebezpečné" }] }),
    usage: { inputTokens: 1000, outputTokens: 100 },
    stopReason: "end_turn",
  });
  const classifyNet = () => "síťová chyba";
  const classifyNone = () => null;

  it("chybějící klíč → skipped, analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiCodeAnalysis({}, payload, "opus", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("BEZ non-goalů přesto běží (code je nezávislý) → analyzed", async () => {
    // klíčový rozdíl proti runAiAnalysis: žádný intent/non-goaly se nepředávají
    const ai = await runAiCodeAnalysis({ [AI_KEY_ENV]: "k" }, payload, "opus", okAnalyze, classifyNone);
    expect(ai.kind).toBe("analyzed");
    if (ai.kind === "analyzed") {
      expect(ai.findings).toHaveLength(1);
      expect(ai.findings[0].rule).toBe("kód: riskantní vzorec");
      expect(ai.usage).toEqual<AiUsage>({ inputTokens: 1000, outputTokens: 100 });
      expect(ai.costUsd).toBeGreaterThan(0);
    }
  });

  it("žádné soubory → skipped, analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiCodeAnalysis({ [AI_KEY_ENV]: "k" }, { text: "", includedFiles: [], truncated: false, oversizedFiles: [] }, "opus", analyze, classifyNone);
    expect(ai).toMatchObject({ kind: "skipped" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("model 'glm' gatuje na ZAI_API_KEY: jen ANTHROPIC nastavený → skipped, analyze se nezavolá", async () => {
    // Zub na kontrakt model→klíč: kdyby orchestrátor četl natvrdo ANTHROPIC místo
    // providerova keyEnv, glm by tu chybně proběhl.
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiCodeAnalysis({ [AI_KEY_ENV]: "sk-ant-k" }, payload, "glm", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("model 'glm' + ZAI_API_KEY → analyzed; dostane ZAI klíč a počítá glm ceníkem", async () => {
    const seen: string[] = [];
    const captureAnalyze: AnalyzeFn = async (apiKey) => {
      seen.push(apiKey);
      return { rawText: JSON.stringify({ findings: [] }), usage: { inputTokens: 1000, outputTokens: 100 }, stopReason: "end_turn" };
    };
    const ai = await runAiCodeAnalysis({ ZAI_API_KEY: "zai-secret" }, payload, "glm", captureAnalyze, classifyNone);
    expect(ai.kind).toBe("analyzed");
    expect(seen).toEqual(["zai-secret"]); // gate sáhl na ZAI klíč, ne ANTHROPIC
    if (ai.kind === "analyzed") {
      // glm: 1000/1e6*1.4 + 100/1e6*4.4 = 0.00184 (opus by dal 0.0075 → zub na ceník)
      expect(ai.costUsd).toBeCloseTo(0.00184, 6);
    }
  });

  it("síťová chyba (classify ji zná) → skipped s důvodem", async () => {
    const analyze: AnalyzeFn = async () => {
      throw new Error("ECONNRESET");
    };
    const ai = await runAiCodeAnalysis({ [AI_KEY_ENV]: "k" }, payload, "opus", analyze, classifyNet);
    expect(ai).toEqual({ kind: "skipped", reason: "síťová chyba" });
  });

  it("nečekaná chyba (rozbitý JSON, end_turn, classify→null) → probublá se stackem", async () => {
    const analyze: AnalyzeFn = async () => ({ rawText: "rozbité", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" });
    await expect(runAiCodeAnalysis({ [AI_KEY_ENV]: "k" }, payload, "opus", analyze, classifyNone)).rejects.toThrow();
  });

  it("uříznutý výstup (max_tokens) → čistý skip s cenou, NE pád na JSON", async () => {
    const analyze: AnalyzeFn = async () => ({ rawText: "", usage: { inputTokens: 70000, outputTokens: 16000 }, stopReason: "max_tokens" });
    const ai = await runAiCodeAnalysis({ [AI_KEY_ENV]: "k" }, payload, "sonnet", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    if (ai.kind === "skipped") {
      expect(ai.reason).toContain("max_tokens");
      expect(ai.reason).toContain("$");
    }
  });

  it("klíč se NIKDY neobjeví v návratu (tajemství)", async () => {
    const ai = await runAiCodeAnalysis({ [AI_KEY_ENV]: "sk-ant-super-secret" }, payload, "opus", okAnalyze, classifyNone);
    expect(JSON.stringify(ai)).not.toContain("super-secret");
  });

  it("předá CODE schéma (s kind, BEZ nonGoalIndex) – kontrakt prompt↔schéma; REGRESE: dřív se omylem posílalo non-goal schéma", async () => {
    const analyze = vi.fn(okAnalyze);
    await runAiCodeAnalysis({ [AI_KEY_ENV]: "k" }, payload, "opus", analyze, classifyNone);
    const schema = analyze.mock.calls[0]?.[4] as { properties: { findings: { items: { properties: Record<string, unknown> } } } };
    expect(schema.properties.findings.items.properties.kind).toBeDefined();
    expect(schema.properties.findings.items.properties.nonGoalIndex).toBeUndefined();
  });
});

describe("LOGIC_FINDINGS_SCHEMA", () => {
  it("file a line jsou NEpovinné (nejsou v required), kind/severity/message povinné", () => {
    const items = (LOGIC_FINDINGS_SCHEMA as { properties: { findings: { items: { required: string[]; properties: Record<string, unknown> } } } }).properties.findings.items;
    expect(items.required).toEqual(["kind", "severity", "message"]);
    expect(items.required).not.toContain("file");
    expect(items.required).not.toContain("line");
    expect(items.properties.file).toBeDefined();
    expect(items.properties.line).toBeDefined();
    // logika nemá vazbu na non-goaly
    expect(items.properties.nonGoalIndex).toBeUndefined();
  });
});

describe("buildLogicPrompt", () => {
  it("obsahuje záměr i kód, NEobsahuje non-goaly", () => {
    const p = buildLogicPrompt("Stavím CLI co čte projekty", payload);
    expect(p).toContain("What I'm building");
    expect(p).toContain("Stavím CLI co čte projekty");
    expect(p).toContain("export const x = 1;");
  });
});

describe("parseLogicFindings – nepovinné místo", () => {
  it("nález bez místa je platný (file/line vynechané)", () => {
    const raw = JSON.stringify({ findings: [{ kind: "chybí funkčnost", severity: "error", message: "neumí X" }] });
    expect(parseLogicFindings(raw)).toEqual([{ kind: "chybí funkčnost", severity: "error", message: "neumí X" }]);
  });

  it("nález s místem si místo zachová", () => {
    const raw = JSON.stringify({ findings: [{ file: "a.ts", line: 1, kind: "rozpor se záměrem", severity: "warning", message: "m" }] });
    expect(parseLogicFindings(raw)).toEqual([{ file: "a.ts", line: 1, kind: "rozpor se záměrem", severity: "warning", message: "m" }]);
  });

  it("špatný tvar (chybí kind) → hodí (nemaskovat jako prázdné)", () => {
    const raw = JSON.stringify({ findings: [{ severity: "info", message: "m" }] });
    expect(() => parseLogicFindings(raw)).toThrow();
  });

  it("přítomné file špatného typu → hodí", () => {
    const raw = JSON.stringify({ findings: [{ file: 5, kind: "k", severity: "info", message: "m" }] });
    expect(() => parseLogicFindings(raw)).toThrow();
  });
});

describe("toLogicFindings – nepovinné místo, ověření jen když je dodáno", () => {
  const included = [{ path: "a.ts", lineCount: 10 }];

  it("bez místa → žádné file/line, ŽÁDNÁ značka neověřeno (legitimní soud o celku)", () => {
    const f = toLogicFindings([{ kind: "chybí funkčnost", severity: "error", message: "neumí X" }], included);
    expect(f[0].file).toBeUndefined();
    expect(f[0].line).toBeUndefined();
    expect(f[0].message).toBe("neumí X");
    expect(f[0].rule).toBe("logika: chybí funkčnost");
  });

  it("file v setu, bez line → file zůstane, line undefined, bez značky (nález o celém souboru)", () => {
    const f = toLogicFindings([{ file: "a.ts", kind: "k", severity: "info", message: "m" }], included);
    expect(f[0].file).toBe("a.ts");
    expect(f[0].line).toBeUndefined();
    expect(f[0].message).toBe("m");
  });

  it("file v setu + platný line → ověřené místo", () => {
    const f = toLogicFindings([{ file: "a.ts", line: 5, kind: "k", severity: "warning", message: "m" }], included);
    expect(f[0].file).toBe("a.ts");
    expect(f[0].line).toBe(5);
    expect(f[0].message).toBe("m");
  });

  it("file mimo poslaný set → file zahozen + značka neověřeno", () => {
    const f = toLogicFindings([{ file: "cizi.ts", line: 3, kind: "k", severity: "info", message: "m" }], included);
    expect(f[0].file).toBeUndefined();
    expect(f[0].message).toContain("místo neověřeno");
    expect(f[0].message).toContain("cizi.ts");
  });

  it("file v setu + line mimo rozsah → file zůstane, line zahozen + značka", () => {
    const f = toLogicFindings([{ file: "a.ts", line: 999, kind: "k", severity: "info", message: "m" }], included);
    expect(f[0].file).toBe("a.ts");
    expect(f[0].line).toBeUndefined();
    expect(f[0].message).toContain("místo neověřeno");
  });
});

describe("runAiLogicAnalysis – orchestrátor (brána na záměru, analyze/classify injektované)", () => {
  const okAnalyze: AnalyzeFn = async () => ({
    rawText: JSON.stringify({ findings: [{ kind: "chybí funkčnost", severity: "error", message: "neumí slíbené X" }] }),
    usage: { inputTokens: 1000, outputTokens: 100 },
    stopReason: "end_turn",
  });
  const classifyNet = () => "síťová chyba";
  const classifyNone = () => null;

  it("chybějící klíč → skipped, analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiLogicAnalysis({}, intentWith(null), payload, "opus", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("BEZ záměru (building null) → skipped, analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, null), payload, "opus", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    if (ai.kind === "skipped") expect(ai.reason).toContain("záměr");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("BEZ záměru (intent null) → skipped, analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, null, payload, "opus", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("se záměrem a soubory → analyzed s nálezem bez místa", async () => {
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, "Stavím CLI"), payload, "opus", okAnalyze, classifyNone);
    expect(ai.kind).toBe("analyzed");
    if (ai.kind === "analyzed") {
      expect(ai.findings).toHaveLength(1);
      expect(ai.findings[0].rule).toBe("logika: chybí funkčnost");
      expect(ai.findings[0].file).toBeUndefined();
      expect(ai.costUsd).toBeGreaterThan(0);
    }
  });

  it("žádné soubory → skipped, analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, "Stavím CLI"), { text: "", includedFiles: [], truncated: false, oversizedFiles: [] }, "opus", analyze, classifyNone);
    expect(ai).toMatchObject({ kind: "skipped" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("UŘÍZNUTÝ kód → skipped (soud o celku nespolehlivý), analyze se nezavolá", async () => {
    const analyze = vi.fn(okAnalyze);
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, "Stavím CLI"), { ...payload, truncated: true }, "opus", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    if (ai.kind === "skipped") expect(ai.reason).toContain("nevešel");
    expect(analyze).not.toHaveBeenCalled();
  });

  it("síťová chyba (classify ji zná) → skipped s důvodem", async () => {
    const analyze: AnalyzeFn = async () => {
      throw new Error("ECONNRESET");
    };
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, "Stavím CLI"), payload, "opus", analyze, classifyNet);
    expect(ai).toEqual({ kind: "skipped", reason: "síťová chyba" });
  });

  it("nečekaná chyba (rozbitý JSON, end_turn, classify→null) → probublá se stackem", async () => {
    const analyze: AnalyzeFn = async () => ({ rawText: "rozbité", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" });
    await expect(runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, "Stavím CLI"), payload, "opus", analyze, classifyNone)).rejects.toThrow();
  });

  it("uříznutý výstup (max_tokens) → čistý skip s cenou, NE pád na JSON", async () => {
    const analyze: AnalyzeFn = async () => ({ rawText: "", usage: { inputTokens: 70000, outputTokens: 16000 }, stopReason: "max_tokens" });
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, "Stavím CLI"), payload, "sonnet", analyze, classifyNone);
    expect(ai.kind).toBe("skipped");
    if (ai.kind === "skipped") {
      expect(ai.reason).toContain("max_tokens");
      expect(ai.reason).toContain("$");
    }
  });

  it("klíč se NIKDY neobjeví v návratu (tajemství)", async () => {
    const ai = await runAiLogicAnalysis({ [AI_KEY_ENV]: "sk-ant-super-secret" }, intentWith(null, "Stavím CLI"), payload, "opus", okAnalyze, classifyNone);
    expect(JSON.stringify(ai)).not.toContain("super-secret");
  });

  it("předá LOGIC schéma (s nepovinným místem, BEZ nonGoalIndex) – kontrakt prompt↔schéma", async () => {
    const analyze = vi.fn(okAnalyze);
    await runAiLogicAnalysis({ [AI_KEY_ENV]: "k" }, intentWith(null, "Stavím CLI"), payload, "opus", analyze, classifyNone);
    const schema = analyze.mock.calls[0]?.[4] as { properties: { findings: { items: { required: string[]; properties: Record<string, unknown> } } } };
    expect(schema.properties.findings.items.required).not.toContain("file");
    expect(schema.properties.findings.items.properties.nonGoalIndex).toBeUndefined();
  });
});
