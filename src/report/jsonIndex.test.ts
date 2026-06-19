import { describe, expect, it } from "vitest";
import type { ModuleGraphResult } from "../analyze/moduleGraph.js";
import type { AuditResult } from "../audit.js";
import type { EslintResult, TscResult } from "../findings.js";
import type { SecretsResult } from "../secrets.js";
import { buildJsonIndex, INDEX_VERSION } from "./jsonIndex.js";

const noEslint: EslintResult = { kind: "skipped", reason: "žádné JS/TS soubory" };
const noSecrets: SecretsResult = { kind: "ran", fileCount: 0, findings: [] };
const noAudit: AuditResult = { kind: "skipped", reason: "audit nevyžádán (--audit)" };
const noGraph: ModuleGraphResult = {
  kind: "ran",
  edges: [],
  isolated: [],
  fileCount: 0,
  unreadable: 0,
  unparsable: 0,
  tooLarge: 0,
};

describe("buildJsonIndex", () => {
  it("verze indexu je 7 (index nese graf modulů)", () => {
    expect(INDEX_VERSION).toBe(7);
  });

  it("nese tsc výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph);
    expect(idx.version).toBe(7);
    expect(idx.tsc).toEqual({ kind: "skipped", reason: "není tsconfig" });
  });

  it("nese eslint výsledek 1:1", () => {
    const eslint: EslintResult = {
      kind: "ran",
      fileCount: 2,
      findings: [{ source: "eslint", severity: "error", file: "a.js", line: 3, column: 5, rule: "eqeqeq", message: "use ===" }],
    };
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, eslint, noSecrets, noAudit, noGraph);
    expect(idx.eslint).toEqual(eslint);
  });

  it("nese audit výsledek 1:1 (i přeskočeno s důvodem)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const audit: AuditResult = {
      kind: "ran",
      counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      findings: [{ source: "audit", severity: "error", file: "package-lock.json", rule: "GHSA-x", message: "lodash@<4 – x; oprava: ano" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, audit, noGraph);
    expect(idx.audit).toEqual(audit);
  });

  it("nese secrets výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const secrets: SecretsResult = {
      kind: "ran",
      fileCount: 3,
      findings: [{ source: "secret", severity: "error", file: ".env", line: 1, rule: "aws-access-key-id", message: "Možné tajemství (AWS Access Key ID): AKIA…(20 znaků)" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, secrets, noAudit, noGraph);
    expect(idx.secrets).toEqual(secrets);
  });

  it("nese moduleGraph výsledek 1:1 (hrany, osamělé i počty)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const graph: ModuleGraphResult = {
      kind: "ran",
      edges: [{ from: "src/a.ts", to: "src/b.ts" }],
      isolated: ["src/c.ts"],
      fileCount: 3,
      unreadable: 1,
      unparsable: 0,
      tooLarge: 0,
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, graph);
    expect(idx.moduleGraph).toEqual(graph);
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
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph);
    expect(idx.tsc).toEqual(tsc);
  });
});
