import { describe, expect, it } from "vitest";
import type { EslintResult, TscResult } from "../findings.js";
import { buildJsonIndex, INDEX_VERSION } from "./jsonIndex.js";

const noEslint: EslintResult = { kind: "skipped", reason: "žádné JS/TS soubory" };

describe("buildJsonIndex", () => {
  it("verze indexu je 4 (tsc výsledek nese tsVersion)", () => {
    expect(INDEX_VERSION).toBe(4);
  });

  it("nese tsc výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint);
    expect(idx.version).toBe(4);
    expect(idx.tsc).toEqual({ kind: "skipped", reason: "není tsconfig" });
  });

  it("nese eslint výsledek 1:1", () => {
    const eslint: EslintResult = {
      kind: "ran",
      fileCount: 2,
      findings: [{ source: "eslint", severity: "error", file: "a.js", line: 3, column: 5, rule: "eqeqeq", message: "use ===" }],
    };
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, eslint);
    expect(idx.eslint).toEqual(eslint);
  });

  it("ran s nálezy projde do JSON včetně fileCount, nodeModulesPresent a verzí", () => {
    const tsc: TscResult = {
      kind: "ran",
      fileCount: 2,
      nodeModulesPresent: false,
      tsVersion: "5.9.3",
      projectTsVersion: "5.4.0",
      findings: [{ source: "tsc", severity: "error", file: "a.ts", line: 1, column: 1, rule: "TS2322", message: "x" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint);
    expect(idx.tsc).toEqual(tsc);
  });
});
