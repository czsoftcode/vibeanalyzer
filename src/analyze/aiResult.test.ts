import { describe, expect, it, vi } from "vitest";
import type { Intent } from "../intent.js";
import { AI_KEY_ENV, type AiUsage } from "./aiStatus.js";
import type { AiPayload } from "./aiPayload.js";
import {
  type AnalyzeFn,
  buildAnalyzePrompt,
  computeCostUsd,
  parseFindings,
  runAiAnalysis,
  toFindings,
} from "./aiResult.js";

const payload: AiPayload = {
  text: "// ==== a.ts ====\nexport const x = 1;\n",
  includedFiles: [{ path: "a.ts", lineCount: 1 }],
  truncated: false,
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
      { text: "", includedFiles: [], truncated: false },
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
});
