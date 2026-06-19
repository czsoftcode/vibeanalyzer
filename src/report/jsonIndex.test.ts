import { describe, expect, it } from "vitest";
import type { AuditResult } from "../audit.js";
import type { EslintResult, TscResult } from "../findings.js";
import type { SecretsResult } from "../secrets.js";
import { buildJsonIndex, INDEX_VERSION } from "./jsonIndex.js";

const noEslint: EslintResult = { kind: "skipped", reason: "žádné JS/TS soubory" };
const noSecrets: SecretsResult = { kind: "ran", fileCount: 0, findings: [] };
const noAudit: AuditResult = { kind: "skipped", reason: "audit nevyžádán (--audit)" };

describe("buildJsonIndex", () => {
  it("verze indexu je 6 (index nese audit)", () => {
    expect(INDEX_VERSION).toBe(6);
  });

  it("nese tsc výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit);
    expect(idx.version).toBe(6);
    expect(idx.tsc).toEqual({ kind: "skipped", reason: "není tsconfig" });
  });

  it("nese eslint výsledek 1:1", () => {
    const eslint: EslintResult = {
      kind: "ran",
      fileCount: 2,
      findings: [{ source: "eslint", severity: "error", file: "a.js", line: 3, column: 5, rule: "eqeqeq", message: "use ===" }],
    };
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const idx = buildJsonIndex("/p", "t", [], tsc, eslint, noSecrets, noAudit);
    expect(idx.eslint).toEqual(eslint);
  });

  it("nese audit výsledek 1:1 (i přeskočeno s důvodem)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const audit: AuditResult = {
      kind: "ran",
      counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      findings: [{ source: "audit", severity: "error", file: "package-lock.json", rule: "GHSA-x", message: "lodash@<4 – x; oprava: ano" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, audit);
    expect(idx.audit).toEqual(audit);
  });

  it("nese secrets výsledek 1:1 (i přeskočeno, ne jen nálezy)", () => {
    const tsc: TscResult = { kind: "skipped", reason: "není tsconfig" };
    const secrets: SecretsResult = {
      kind: "ran",
      fileCount: 3,
      findings: [{ source: "secret", severity: "error", file: ".env", line: 1, rule: "aws-access-key-id", message: "Možné tajemství (AWS Access Key ID): AKIA…(20 znaků)" }],
    };
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, secrets, noAudit);
    expect(idx.secrets).toEqual(secrets);
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
    const idx = buildJsonIndex("/p", "t", [], tsc, noEslint, noSecrets, noAudit);
    expect(idx.tsc).toEqual(tsc);
  });
});
