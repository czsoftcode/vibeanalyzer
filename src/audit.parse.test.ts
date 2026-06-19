import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditDependencies, parseAuditJson } from "./audit.js";

/** Minimální validní v2 report s jednou zranitelností. */
function v2Report(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      lodash: {
        name: "lodash",
        severity: "high",
        isDirect: true,
        range: "<4.17.21",
        via: [
          {
            source: 1065,
            name: "lodash",
            title: "Command Injection in lodash",
            url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
            severity: "high",
            range: "<4.17.21",
          },
        ],
        fixAvailable: true,
      },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
    },
    ...overrides,
  });
}

describe("parseAuditJson – validní v2 report", () => {
  it("zranitelnost → ran s nálezem (GHSA, severity, místo, oprava)", () => {
    const res = parseAuditJson(v2Report());
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings).toHaveLength(1);
    const f = res.findings[0];
    expect(f.source).toBe("audit");
    expect(f.severity).toBe("error"); // high → error
    expect(f.file).toBe("package-lock.json");
    expect(f.rule).toBe("GHSA-35jh-r3h4-6jhm");
    expect(f.message).toContain("lodash@<4.17.21");
    expect(f.message).toContain("Command Injection");
    expect(f.message).toContain("oprava: ano");
    expect(res.counts).toEqual({ info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 });
  });

  it("prázdné vulnerabilities → ran s 0 nálezy (čisto, NE skipped)", () => {
    const clean = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {},
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    });
    const res = parseAuditJson(clean);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings).toEqual([]);
    expect(res.counts.total).toBe(0);
  });

  it("severity mapping: critical→error, moderate→warning, low→info", () => {
    const make = (sev: string) =>
      JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: { p: { name: "p", severity: sev, range: "*", via: [], fixAvailable: false } },
      });
    expect((parseAuditJson(make("critical")) as { findings: { severity: string }[] }).findings[0].severity).toBe("error");
    expect((parseAuditJson(make("moderate")) as { findings: { severity: string }[] }).findings[0].severity).toBe("warning");
    expect((parseAuditJson(make("low")) as { findings: { severity: string }[] }).findings[0].severity).toBe("info");
  });

  it("via jen jako stringy (tranzitivní) → detail 'zranitelné přes'", () => {
    const transitive = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        "@babel/traverse": { name: "@babel/traverse", severity: "moderate", range: "*", via: ["lodash"], fixAvailable: false },
      },
    });
    const res = parseAuditJson(transitive);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings[0].message).toContain("zranitelné přes lodash");
    expect(res.findings[0].rule).toBeUndefined();
  });

  it("fixAvailable jako objekt → 'oprava: ano (name@version, major)'", () => {
    const res = parseAuditJson(
      v2Report({
        vulnerabilities: {
          lodash: {
            name: "lodash",
            severity: "high",
            range: "<4.17.21",
            via: [{ title: "x", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }],
            fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: true },
          },
        },
      }),
    );
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings[0].message).toContain("oprava: ano (lodash@4.17.21, major");
  });
});

describe("parseAuditJson – skip (ne pád) u nečekaných vstupů", () => {
  it("nevalidní JSON → skipped", () => {
    const res = parseAuditJson("ne json {{{");
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("nevalidní JSON");
  });

  it("top-level error (síť) → skipped s kódem", () => {
    const res = parseAuditJson(JSON.stringify({ error: { code: "ENOTFOUND", summary: "nelze se připojit" } }));
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("ENOTFOUND");
  });

  it("npm v6 formát (advisories) → skipped jako nepodporovaný", () => {
    const res = parseAuditJson(JSON.stringify({ advisories: { "118": {} }, metadata: {} }));
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("nepodporovaný formát");
  });
});

describe("auditDependencies – složení runneru a parseru (bez sítě)", () => {
  let proj: string;
  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-audit-int-"));
    await writeFile(path.join(proj, "package.json"), "{}\n");
    await writeFile(path.join(proj, "package-lock.json"), "{}\n");
  });
  afterEach(async () => {
    await rm(proj, { recursive: true, force: true }).catch(() => {});
  });

  it("injektovaný runner s vuln JSON → ran s nálezem", async () => {
    const res = await auditDependencies(proj, {
      dev: false,
      runner: async () => ({ kind: "output", stdout: v2Report() }),
    });
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].rule).toBe("GHSA-35jh-r3h4-6jhm");
  });

  it("chybějící lockfile → skipped i přes auditDependencies", async () => {
    await rm(path.join(proj, "package-lock.json"));
    const res = await auditDependencies(proj, { dev: false, runner: async () => ({ kind: "output", stdout: "{}" }) });
    expect(res.kind).toBe("skipped");
  });
});
