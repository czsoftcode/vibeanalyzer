import { describe, expect, it } from "vitest";
import type { TscResult } from "../findings.js";
import { buildJsonIndex, INDEX_VERSION } from "./jsonIndex.js";

describe("buildJsonIndex", () => {
  it("verze indexu je 2 (přidáno pole tsc)", () => {
    expect(INDEX_VERSION).toBe(2);
  });

  it("nese tsc výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc);
    expect(idx.version).toBe(2);
    expect(idx.tsc).toEqual({ kind: "skipped", reason: "není tsconfig" });
  });

  it("ran s nálezy projde do JSON včetně fileCount a nodeModulesPresent", () => {
    const tsc: TscResult = {
      kind: "ran",
      fileCount: 2,
      nodeModulesPresent: false,
      findings: [{ source: "tsc", severity: "error", file: "a.ts", line: 1, column: 1, rule: "TS2322", message: "x" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc);
    expect(idx.tsc).toEqual(tsc);
  });
});
