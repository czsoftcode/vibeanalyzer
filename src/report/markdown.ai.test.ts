import { describe, expect, it } from "vitest";
import { AI_KEY_ENV, type AiReport, type AiStatus, detectAiStatus } from "../analyze/aiStatus.js";
import { buildMarkdown, type MarkdownInput } from "./markdown.js";

const base: MarkdownInput = {
  root: "/proj",
  generatedAt: "2026-06-20T00:00:00Z",
  files: [],
  skippedUnreadable: [],
};

/** Pomocník: AiReport ze stavů; `logic` se defaultně rovná `code` (testy ho přepíšou, kde záleží). */
function report(nonGoal: AiStatus, code: AiStatus, logic: AiStatus = code): AiReport {
  return { nonGoal, code, logic };
}

const analyzedNonGoal: AiStatus = {
  kind: "analyzed",
  model: "opus",
  findings: [{ source: "ai", severity: "error", file: "a.ts", line: 5, rule: "non-goal: Nespouštět kód", message: "spouští kód" }],
  usage: { inputTokens: 1234, outputTokens: 56 },
  costUsd: 0.0123,
};
const analyzedCode: AiStatus = {
  kind: "analyzed",
  model: "sonnet",
  findings: [{ source: "ai", severity: "warning", file: "b.ts", line: 9, rule: "kód: logická chyba", message: "off-by-one" }],
  usage: { inputTokens: 2000, outputTokens: 80 },
  costUsd: 0.0456,
};

describe("buildMarkdown – AI sekce: tři nezávislé režimy (non-goal + code + logic)", () => {
  it("chybějící ai (undefined) → jedna hlavička, všechny tři pod-bloky přeskočeno", () => {
    const md = buildMarkdown(base);
    expect(md).toContain("## AI analýza");
    expect(md).toContain("### Porušení non-goalů (--ai-non-goal)");
    expect(md).toContain("### Kvalita a rizika kódu (--ai-code)");
    expect(md).toContain("### Logika vs záměr (--ai-logic)");
    expect(md).toContain("_Přeskočeno:");
    expect(md).toContain("- AI (non-goaly): přeskočeno");
    expect(md).toContain("- AI (kód): přeskočeno");
    expect(md).toContain("- AI (logika): přeskočeno");
  });

  it("logika: přiznání aproximace je VŽDY v bloku + nález míří na celek (bez řádku)", () => {
    const analyzedLogic: AiStatus = {
      kind: "analyzed",
      model: "opus",
      findings: [{ source: "ai", severity: "error", rule: "logika: chybí funkčnost", message: "neumí slíbené X" }],
      usage: { inputTokens: 300, outputTokens: 60 },
      costUsd: 0.0099,
    };
    const md = buildMarkdown({ ...base, ai: report(detectAiStatus({}), detectAiStatus({}), analyzedLogic) });
    expect(md).toContain("neúplná APROXIMACE");
    expect(md).toContain("logika: chybí funkčnost");
    expect(md).toContain("neumí slíbené X");
    expect(md).toContain("- AI (logika): analyzováno (1 nálezů, ~$0.0099)");
  });

  it("logika skipped (bez záměru) → vlastní důvod + souhrn přeskočeno", () => {
    const md = buildMarkdown({ ...base, ai: report(detectAiStatus({}), detectAiStatus({}), { kind: "skipped", reason: "chybí záměr v project.md" }) });
    expect(md).toContain("chybí záměr v project.md");
    expect(md).toContain("- AI (logika): přeskočeno");
  });

  it("bez klíče (reálný detectAiStatus pro oba) → 'chybí ANTHROPIC_API_KEY' v obou", () => {
    // Kontrakt mezi moduly: text reportu skládáme z REÁLNÉHO výstupu detekce.
    const skip = detectAiStatus({});
    const md = buildMarkdown({ ...base, ai: report(skip, skip) });
    expect(md).toContain("chybí ANTHROPIC_API_KEY");
    expect(md).toContain("- AI (non-goaly): přeskočeno");
    expect(md).toContain("- AI (kód): přeskočeno");
  });

  it("s klíčem (reálný detectAiStatus) → oba 'připraveno', ne falešné 'hotovo'", () => {
    const ready = detectAiStatus({ [AI_KEY_ENV]: "sk-ant-xxx" });
    const md = buildMarkdown({ ...base, ai: report(ready, ready) });
    expect(md).toContain("Připraveno (klíč nalezen, dotaz zatím neproběhl)");
    expect(md).toContain("- AI (non-goaly): připraveno");
    expect(md).toContain("- AI (kód): připraveno");
  });

  it("oba analyzed → DVĚ oddělené sekce, DVĚ různé ceny, nálezy přes formatLocation", () => {
    const md = buildMarkdown({ ...base, ai: report(analyzedNonGoal, analyzedCode) });
    // non-goal blok
    expect(md).toContain("Model opus");
    expect(md).toContain("1234 vstup + 56 výstup");
    expect(md).toContain("~$0.0123");
    expect(md).toContain("`a.ts:5`");
    expect(md).toContain("spouští kód");
    // code blok – samostatná cena i nález
    expect(md).toContain("Model sonnet");
    expect(md).toContain("2000 vstup + 80 výstup");
    expect(md).toContain("~$0.0456");
    expect(md).toContain("`b.ts:9`");
    expect(md).toContain("off-by-one");
    expect(md).toContain("kód: logická chyba");
    // dva souhrny
    expect(md).toContain("- AI (non-goaly): analyzováno (1 nálezů, ~$0.0123)");
    expect(md).toContain("- AI (kód): analyzováno (1 nálezů, ~$0.0456)");
  });

  it("nezávislost: non-goal analyzed, code skipped → každý svůj stav", () => {
    const md = buildMarkdown({ ...base, ai: report(analyzedNonGoal, { kind: "skipped", reason: "žádné zdrojové soubory k analýze" }) });
    expect(md).toContain("- AI (non-goaly): analyzováno");
    expect(md).toContain("- AI (kód): přeskočeno");
    expect(md).toContain("žádné zdrojové soubory");
  });

  it("analyzed bez nálezů → 'Žádné...' zprávy (ne tiché prázdno), zvlášť pro každý režim", () => {
    const md = buildMarkdown({
      ...base,
      ai: report(
        { kind: "analyzed", model: "opus", findings: [], usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0 },
        { kind: "analyzed", model: "opus", findings: [], usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0 },
      ),
    });
    expect(md).toContain("Žádné porušení deklarovaných non-goalů nenalezeno");
    expect(md).toContain("Žádné závažné problémy kódu nenalezeny");
  });

  it("verified (--ai-check) v non-goal poli → 'Ověřeno'", () => {
    const md = buildMarkdown({ ...base, ai: report({ kind: "verified" }, detectAiStatus({})) });
    expect(md).toContain("Ověřeno (testovací dotaz na API proběhl");
    expect(md).toContain("- AI (non-goaly): ověřeno");
  });

  it("oversizedFiles → poznámka pod ## AI analýza vypíše vynechané soubory (jednou)", () => {
    const skip = detectAiStatus({});
    const md = buildMarkdown({ ...base, ai: { ...report(skip, skip), oversizedFiles: ["src/huge.ts", "lib/big.ts"] } });
    expect(md).toContain("AI NEvidělo");
    expect(md).toContain("`src/huge.ts`");
    expect(md).toContain("`lib/big.ts`");
    // poznámka jen JEDNOU (sdílená), ne v každém ze tří mode-bloků
    expect(md.match(/AI NEvidělo/g)).toHaveLength(1);
  });

  it("prázdné/chybějící oversizedFiles → žádná poznámka", () => {
    const skip = detectAiStatus({});
    const mdEmpty = buildMarkdown({ ...base, ai: { ...report(skip, skip), oversizedFiles: [] } });
    expect(mdEmpty).not.toContain("AI NEvidělo");
    const mdUndef = buildMarkdown({ ...base, ai: report(skip, skip) });
    expect(mdUndef).not.toContain("AI NEvidělo");
  });

  it("truncation → poznámka pod ## AI analýza přizná neúplný projekt s počty (jednou)", () => {
    const skip = detectAiStatus({});
    const md = buildMarkdown({ ...base, ai: { ...report(skip, skip), truncation: { includedFiles: 18, omittedFiles: 7, omittedBytes: 635_000 } } });
    expect(md).toContain("AI viděla 18 z 25 zdrojových souborů");
    expect(md).toContain("7 souborů");
    expect(md).toContain("posouzení je neúplné");
    // velikost v lidské podobě (kB), ne syrové bajty
    expect(md).toContain("620 kB");
    // poznámka jen JEDNOU (sdílená), ne v každém ze tří mode-bloků
    expect(md.match(/AI viděla 18 z 25/g)).toHaveLength(1);
  });

  it("bez truncation (undefined) → žádná poznámka o uříznutí", () => {
    const skip = detectAiStatus({});
    const mdUndef = buildMarkdown({ ...base, ai: report(skip, skip) });
    expect(mdUndef).not.toContain("posouzení je neúplné");
    expect(mdUndef).not.toContain("zdrojových souborů");
  });

  it("truncation + oversizedFiles současně → obě poznámky, truncation první, sekce zůstane validní", () => {
    const skip = detectAiStatus({});
    const md = buildMarkdown({
      ...base,
      ai: { ...report(skip, skip), truncation: { includedFiles: 3, omittedFiles: 5, omittedBytes: 500_000 }, oversizedFiles: ["src/huge.ts"] },
    });
    expect(md).toContain("AI viděla 3 z 8 zdrojových souborů");
    expect(md).toContain("AI NEvidělo");
    // pořadí: poznámka o uříznutí je nad poznámkou o oversized souborech
    expect(md.indexOf("AI viděla 3 z 8")).toBeLessThan(md.indexOf("AI NEvidělo"));
    // obě jen jednou (sdílené, ne v mode-blocích)
    expect(md.match(/AI viděla 3 z 8/g)).toHaveLength(1);
    expect(md.match(/AI NEvidělo/g)).toHaveLength(1);
  });

  it("hodnota klíče se NIKDY neobjeví v reportu (tajemství)", () => {
    const ready = detectAiStatus({ [AI_KEY_ENV]: "sk-ant-super-secret" });
    const md = buildMarkdown({ ...base, ai: report(ready, ready) });
    expect(md).not.toContain("super-secret");
  });
});
