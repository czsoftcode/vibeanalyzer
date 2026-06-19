import { describe, expect, it } from "vitest";
import { type EslintResult, type Finding, formatLocation, type TscResult } from "./findings.js";

describe("formatLocation", () => {
  it("plné umístění soubor:řádek:sloupec", () => {
    const f: Finding = { source: "tsc", severity: "error", file: "src/a.ts", line: 12, column: 5, message: "x" };
    expect(formatLocation(f)).toBe("src/a.ts:12:5");
  });

  it("bez sloupce → soubor:řádek", () => {
    const f: Finding = { source: "tsc", severity: "warning", file: "src/a.ts", line: 12, message: "x" };
    expect(formatLocation(f)).toBe("src/a.ts:12");
  });

  it("jen soubor → soubor", () => {
    const f: Finding = { source: "tsc", severity: "info", file: "src/a.ts", message: "x" };
    expect(formatLocation(f)).toBe("src/a.ts");
  });

  it("globální chyba bez souboru → (bez umístění)", () => {
    const f: Finding = { source: "tsc", severity: "error", message: "neznámá volba" };
    expect(formatLocation(f)).toBe("(bez umístění)");
  });
});

describe("TscResult diskriminace", () => {
  it("ran a skipped jsou rozlišitelné podle kind", () => {
    const ran: TscResult = { kind: "ran", findings: [], fileCount: 3, nodeModulesPresent: true };
    const skipped: TscResult = { kind: "skipped", reason: "není tsconfig" };
    expect(ran.kind).toBe("ran");
    expect(skipped.kind).toBe("skipped");
    // "ran s 0 nálezy" NENÍ "skipped" – to je celé jádro kontraktu
    if (ran.kind === "ran") expect(ran.findings).toHaveLength(0);
  });
});

describe("EslintResult diskriminace", () => {
  it("ran a skipped jsou rozlišitelné podle kind", () => {
    const ran: EslintResult = { kind: "ran", findings: [], fileCount: 2, skippedMinified: 0 };
    const skipped: EslintResult = { kind: "skipped", reason: "žádné JS/TS soubory" };
    expect(ran.kind).toBe("ran");
    expect(skipped.kind).toBe("skipped");
    if (ran.kind === "ran") expect(ran.fileCount).toBe(2);
  });

  it("Finding přijme source eslint", () => {
    const f: Finding = { source: "eslint", severity: "error", file: "a.js", line: 1, column: 1, rule: "eqeqeq", message: "x" };
    expect(f.source).toBe("eslint");
  });
});
