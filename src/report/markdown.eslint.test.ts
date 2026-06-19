import { describe, expect, it } from "vitest";
import type { EslintResult } from "../findings.js";
import { buildMarkdown } from "./markdown.js";

const base = {
  root: "/p",
  generatedAt: "t",
  files: [],
  skippedUnreadable: [],
};

describe("buildMarkdown – sekce Strojové nálezy (ESLint)", () => {
  it("skipped: vypíše důvod, ne pád", () => {
    const eslint: EslintResult = { kind: "skipped", reason: "žádné JS/TS soubory" };
    const md = buildMarkdown({ ...base, eslint });
    expect(md).toContain("## Strojové nálezy (ESLint)");
    expect(md).toContain("_ESLint přeskočeno: žádné JS/TS soubory_");
    expect(md).toContain("- ESLint: přeskočeno");
  });

  it("ran s 0 nálezy NENÍ totéž co přeskočeno", () => {
    const eslint: EslintResult = { kind: "ran", findings: [], fileCount: 4, skippedMinified: 0 };
    const md = buildMarkdown({ ...base, eslint });
    expect(md).toContain("_Žádné nálezy._");
    expect(md).toContain("- ESLint: čistý (0 nálezů)");
    expect(md).not.toContain("ESLint přeskočeno");
    // bez minifikátů se poznámka o přeskočení NEvypíše
    expect(md).not.toContain("Přeskočeno");
  });

  it("ran s nálezy: soubor:řádek:sloupec, závažnost, pravidlo, zpráva", () => {
    const eslint: EslintResult = {
      kind: "ran",
      fileCount: 1,
      skippedMinified: 0,
      findings: [{ source: "eslint", severity: "error", file: "src/a.js", line: 9, column: 7, rule: "eqeqeq", message: "Expected '===' and instead saw '=='." }],
    };
    const md = buildMarkdown({ ...base, eslint });
    expect(md).toContain("`src/a.js:9:7`");
    expect(md).toContain("eqeqeq");
    expect(md).toContain("**error**");
    expect(md).toContain("- ESLint: 1 nálezů");
  });

  it("ran se skippedMinified > 0: vypíše poznámku o přeskočených minifikátech i v1 omezení", () => {
    const eslint: EslintResult = { kind: "ran", findings: [], fileCount: 2, skippedMinified: 3 };
    const md = buildMarkdown({ ...base, eslint });
    expect(md).toContain("Přeskočeno 3 minifikátů");
    expect(md).toContain("*.min.*");
    // přiznané v1 omezení: bundly bez .min. se NEfiltrují
    expect(md).toContain("bundle.js");
    // rychlý přehled NESMÍ tichý: i u „čistý" hlásí přeskočené (cíl: žádné tiché vynechání)
    expect(md).toContain("- ESLint: čistý (0 nálezů), 3 minifikátů přeskočeno");
  });

  it("bez eslint vstupu → sekce přesto existuje a hlásí přeskočeno", () => {
    const md = buildMarkdown({ ...base });
    expect(md).toContain("## Strojové nálezy (ESLint)");
    expect(md).toContain("_ESLint přeskočeno:");
  });
});
