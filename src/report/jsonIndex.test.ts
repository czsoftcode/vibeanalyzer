import { describe, expect, it } from "vitest";
import type { AiStatus } from "../analyze/aiStatus.js";
import type { ModuleGraphResult } from "../analyze/moduleGraph.js";
import type { AuditResult } from "../audit.js";
import type { EslintResult, TscResult } from "../findings.js";
import type { FileEntry } from "../scan.js";
import type { SecretsResult } from "../secrets.js";
import { buildJsonIndex, INDEX_VERSION } from "./jsonIndex.js";

const noEslint: EslintResult = { kind: "skipped", reason: "žádné JS/TS soubory" };
const noSecrets: SecretsResult = {
  kind: "ran",
  fileCount: 0,
  findings: [],
  skipped: { minified: 0, large: 0, longLine: 0, binary: 0 },
};
const noAudit: AuditResult = { kind: "skipped", reason: "audit nevyžádán (--audit)" };
const noAi: AiStatus = { kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" };
const noGraph: ModuleGraphResult = {
  kind: "ran",
  edges: [],
  isolated: [],
  fileCount: 0,
  unreadable: 0,
  unparsable: 0,
  tooLarge: 0,
  minified: 0,
};

describe("buildJsonIndex", () => {
  it("verze indexu je 13 (`ai` má variantu `analyzed`)", () => {
    expect(INDEX_VERSION).toBe(13);
  });

  it("nese tsc výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph, noAi);
    expect(idx.version).toBe(INDEX_VERSION);
    expect(idx.tsc).toEqual({ kind: "skipped", reason: "není tsconfig" });
  });

  it("nese ai stav 1:1 (skipped i ready – ne tiché vynechání)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const skipped = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph, noAi);
    expect(skipped.ai).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    const ready = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph, { kind: "ready" });
    expect(ready.ai).toEqual({ kind: "ready" });
    const verified = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph, { kind: "verified" });
    expect(verified.ai).toEqual({ kind: "verified" });
    const analyzedAi: AiStatus = {
      kind: "analyzed",
      model: "opus",
      findings: [{ source: "ai", severity: "error", file: "a.ts", line: 1, rule: "non-goal: x", message: "m" }],
      usage: { inputTokens: 100, outputTokens: 20 },
      costUsd: 0.001,
    };
    const analyzed = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph, analyzedAi);
    expect(analyzed.ai).toEqual(analyzedAi);
  });

  it("nese files 1:1 včetně příznaku minified (kontrakt JSONu)", () => {
    const files: FileEntry[] = [
      { path: "src/index.ts", type: "file", ext: ".ts", size: 20, depth: 2, minified: false },
      { path: "src/app.min.js", type: "file", ext: ".js", size: 999, depth: 2, minified: true },
    ];
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", files, tsc, noEslint, noSecrets, noAudit, noGraph, noAi);
    expect(idx.files).toEqual(files); // pole projde 1:1
    expect(idx.files.find((f) => f.path === "src/app.min.js")?.minified).toBe(true);
    expect(idx.files.find((f) => f.path === "src/index.ts")?.minified).toBe(false);
  });

  it("nese eslint výsledek 1:1", () => {
    const eslint: EslintResult = {
      kind: "ran",
      fileCount: 2,
      skippedMinified: 1,
      findings: [{ source: "eslint", severity: "error", file: "a.js", line: 3, column: 5, rule: "eqeqeq", message: "use ===" }],
    };
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, eslint, noSecrets, noAudit, noGraph, noAi);
    expect(idx.eslint).toEqual(eslint);
  });

  it("nese audit výsledek 1:1 (i přeskočeno s důvodem)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const audit: AuditResult = {
      kind: "ran",
      counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      findings: [{ source: "audit", severity: "error", file: "package-lock.json", rule: "GHSA-x", message: "lodash@<4 – x; oprava: ano" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, audit, noGraph, noAi);
    expect(idx.audit).toEqual(audit);
  });

  it("nese secrets výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const secrets: SecretsResult = {
      kind: "ran",
      fileCount: 3,
      findings: [{ source: "secret", severity: "error", file: ".env", line: 1, rule: "aws-access-key-id", message: "Možné tajemství (AWS Access Key ID): AKIA…(20 znaků)" }],
      skipped: { minified: 2, large: 1, longLine: 0, binary: 1 },
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, secrets, noAudit, noGraph, noAi);
    expect(idx.secrets).toEqual(secrets); // skipped musí projít 1:1 (ne tiché zahození)
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
      minified: 2,
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, graph, noAi);
    expect(idx.moduleGraph).toEqual(graph);
  });

  it("ran s nálezy projde do JSON včetně fileCount, nodeModulesPresent a verzí", () => {
    const tsc: TscResult = {
      kind: "ran",
      fileCount: 2,
      nodeModulesPresent: false,
      hoistedNodeModules: true,
      tsVersion: "5.9.3",
      projectTsVersion: "5.4.0",
      findings: [{ source: "tsc", severity: "error", file: "a.ts", line: 1, column: 1, rule: "TS2322", message: "x" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit, noGraph, noAi);
    expect(idx.tsc).toEqual(tsc);
  });
});
