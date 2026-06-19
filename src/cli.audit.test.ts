import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditResult } from "./audit.js";
import { run } from "./cli.js";

// In-process (bez forku), bez sítě – audit se injektuje, kde má najít nález.
process.env.VIBE_ANALYSIS_INPROCESS = "1";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-audit-"));
  await writeFile(path.join(proj, "index.ts"), "export const x = 1;\n", "utf8");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

async function readOutputs(outDir: string): Promise<{ md: string; json: string }> {
  const files = await readdir(outDir);
  const mdName = files.find((f) => f.endsWith(".md"));
  const jsonName = files.find((f) => f.endsWith(".json"));
  return {
    md: await readFile(path.join(outDir, mdName as string), "utf8"),
    json: await readFile(path.join(outDir, jsonName as string), "utf8"),
  };
}

describe("run – e2e audit závislostí", () => {
  it("--audit s injektovaným nálezem → report ho označí (md i JSON)", async () => {
    const fakeAudit: AuditResult = {
      kind: "ran",
      counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      findings: [
        { source: "audit", severity: "error", file: "package-lock.json", rule: "GHSA-35jh-r3h4-6jhm", message: "lodash@<4.17.21 – Command Injection (závažnost: high); oprava: ano" },
      ],
    };
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--audit"], proj, {
      auditFn: async () => fakeAudit,
    });
    expect(code).toBe(0);

    const { md, json } = await readOutputs(outDir);
    expect(md).toContain("## Strojové nálezy (závislosti)");
    expect(md).toContain("GHSA-35jh-r3h4-6jhm");
    expect(md).toContain("- Závislosti: 1 nálezů");
    const index = JSON.parse(json);
    expect(index.audit.kind).toBe("ran");
    expect(index.audit.findings[0].rule).toBe("GHSA-35jh-r3h4-6jhm");
  });

  it("bez --audit → sekce 'přeskočeno (nevyžádán)', audit se vůbec nezavolá", async () => {
    let called = false;
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj, {
      auditFn: async () => {
        called = true;
        return { kind: "ran", counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }, findings: [] };
      },
    });
    expect(code).toBe(0);
    expect(called).toBe(false); // bez --audit se injektovaný audit NESMÍ spustit

    const { md, json } = await readOutputs(outDir);
    expect(md).toContain("Audit závislostí přeskočen");
    expect(md).toContain("nevyžádán");
    const index = JSON.parse(json);
    expect(index.audit).toEqual({ kind: "skipped", reason: "audit nevyžádán (spusť s --audit)" });
  });

  it("--audit bez lockfilu (reálný audit, bez sítě) → skip s důvodem o lockfilu", async () => {
    // Žádná injekce → reálný auditDependencies; bez package.json/lockfilu skipne
    // PŘED spuštěním npm, takže žádná síť.
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--audit"], proj);
    expect(code).toBe(0);

    const { json } = await readOutputs(outDir);
    const index = JSON.parse(json);
    expect(index.audit.kind).toBe("skipped");
    expect(index.audit.reason).toMatch(/package\.json|lockfile/);
  });
});
