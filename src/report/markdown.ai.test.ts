import { describe, expect, it } from "vitest";
import { AI_KEY_ENV, detectAiStatus } from "../analyze/aiStatus.js";
import { buildMarkdown, type MarkdownInput } from "./markdown.js";

const base: MarkdownInput = {
  root: "/proj",
  generatedAt: "2026-06-20T00:00:00Z",
  files: [],
  skippedUnreadable: [],
};

describe("buildMarkdown – sekce AI vrstvy: dva rozlišitelné stavy", () => {
  it("chybějící ai (undefined) → přeskočeno s výchozím důvodem", () => {
    const md = buildMarkdown(base);
    expect(md).toContain("## AI analýza (logika a non-goaly)");
    expect(md).toContain("AI přeskočeno:");
    expect(md).toContain("- AI (logika a non-goaly): přeskočeno");
  });

  it("bez klíče (reálný detectAiStatus) → 'AI přeskočeno: chybí ANTHROPIC_API_KEY'", () => {
    // Kontrakt mezi moduly: text reportu skládáme z REÁLNÉHO výstupu detekce,
    // ne z ručně zadaného důvodu – kdyby se důvod v aiStatus.ts změnil, test padne.
    const md = buildMarkdown({ ...base, ai: detectAiStatus({}) });
    expect(md).toContain("AI přeskočeno: chybí ANTHROPIC_API_KEY");
    expect(md).toContain("- AI (logika a non-goaly): přeskočeno");
  });

  it("s klíčem (reálný detectAiStatus) → připraveno, ne falešné 'hotovo'", () => {
    const md = buildMarkdown({ ...base, ai: detectAiStatus({ [AI_KEY_ENV]: "sk-ant-xxx" }) });
    expect(md).toContain("AI připraveno (klíč nalezen, dotaz zatím neproběhl)");
    expect(md).toContain("- AI (logika a non-goaly): připraveno");
    expect(md).not.toContain("AI přeskočeno");
  });

  it("verified → 'AI ověřeno' a souhrn 'ověřeno' (ne 'připraveno', ne 'přeskočeno')", () => {
    const md = buildMarkdown({ ...base, ai: { kind: "verified" } });
    expect(md).toContain("AI ověřeno (testovací dotaz na API proběhl");
    expect(md).toContain("- AI (logika a non-goaly): ověřeno");
    expect(md).not.toContain("AI připraveno");
    expect(md).not.toContain("AI přeskočeno");
  });

  it("analyzed → vykreslí nálezy (přes formatLocation), tokeny a cenu + souhrn 'analyzováno'", () => {
    const md = buildMarkdown({
      ...base,
      ai: {
        kind: "analyzed",
        model: "opus",
        findings: [{ source: "ai", severity: "error", file: "a.ts", line: 5, rule: "non-goal: Nespouštět kód", message: "spouští kód" }],
        usage: { inputTokens: 1234, outputTokens: 56 },
        costUsd: 0.0123,
      },
    });
    expect(md).toContain("model opus");
    expect(md).toContain("1234 vstup + 56 výstup");
    expect(md).toContain("~$0.0123");
    expect(md).toContain("`a.ts:5`"); // místo přes formatLocation
    expect(md).toContain("spouští kód");
    expect(md).toContain("- AI (logika a non-goaly): analyzováno (1 nálezů, ~$0.0123)");
  });

  it("analyzed bez nálezů → 'Žádné porušení...' (ne tiché prázdno)", () => {
    const md = buildMarkdown({
      ...base,
      ai: { kind: "analyzed", model: "sonnet", findings: [], usage: { inputTokens: 10, outputTokens: 2 }, costUsd: 0 },
    });
    expect(md).toContain("Žádné porušení deklarovaných non-goalů nenalezeno");
    expect(md).toContain("analyzováno (0 nálezů");
  });

  it("hodnota klíče se NIKDY neobjeví v reportu (tajemství)", () => {
    const md = buildMarkdown({ ...base, ai: detectAiStatus({ [AI_KEY_ENV]: "sk-ant-super-secret" }) });
    expect(md).not.toContain("super-secret");
  });
});
