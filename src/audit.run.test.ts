import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectAuditOutput,
  type NpmAuditRunner,
  type NpmRunOutcome,
  runProcessForAudit,
} from "./audit.js";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-audit-proj-"));
});

afterEach(async () => {
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("runProcessForAudit – past s exit kódem a chybové mapování (bez sítě)", () => {
  it("NENULOVÝ exit + stdout → output (npm audit s nálezy NENÍ selhání)", async () => {
    const out = await runProcessForAudit(
      process.execPath,
      ["-e", "process.stdout.write('{\"vuln\":true}'); process.exit(1)"],
      { cwd: proj, timeoutMs: 10_000 },
    );
    expect(out.kind).toBe("output");
    if (out.kind !== "output") return;
    expect(out.stdout).toContain('{"vuln":true}');
  });

  it("chybějící binárka → spawn-failed (ne pád)", async () => {
    const out = await runProcessForAudit("vibe-nonexistent-binary-xyz", ["x"], {
      cwd: proj,
      timeoutMs: 5_000,
    });
    expect(out.kind).toBe("spawn-failed");
  });

  it("překročení timeoutu → timeout", async () => {
    const out = await runProcessForAudit(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10000)"],
      { cwd: proj, timeoutMs: 250 },
    );
    expect(out.kind).toBe("timeout");
  });

  it("externí SIGKILL (OOM) NENÍ timeout – nelže o příčině", async () => {
    // Child se zabije SÁM signálem SIGKILL → killed===false, signal==="SIGKILL".
    // Timeout je velký, takže se nesmí spustit; nesmí to být hlášeno jako timeout.
    const out = await runProcessForAudit(
      process.execPath,
      ["-e", "process.kill(process.pid, 'SIGKILL')"],
      { cwd: proj, timeoutMs: 10_000 },
    );
    expect(out.kind).not.toBe("timeout");
    expect(out.kind).toBe("spawn-failed");
    if (out.kind !== "spawn-failed") return;
    expect(out.reason).toContain("SIGKILL");
  });
});

describe("collectAuditOutput – skip důvody a izolace", () => {
  const okRunner: NpmAuditRunner = async () => ({ kind: "output", stdout: '{"auditReportVersion":2}' });

  it("bez package.json → skip s důvodem", async () => {
    const res = await collectAuditOutput(proj, { dev: false, runner: okRunner });
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("package.json");
  });

  it("s package.json, ale bez lockfilu → skip zmiňující lockfile", async () => {
    await writeFile(path.join(proj, "package.json"), "{}\n");
    const res = await collectAuditOutput(proj, { dev: false, runner: okRunner });
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("lockfile");
  });

  it("s lockfilem → output; runner běží v TEMP (ne v projektu) a temp se uklidí", async () => {
    await writeFile(path.join(proj, "package.json"), "{}\n");
    await writeFile(path.join(proj, "package-lock.json"), "{}\n");

    let seenCwd = "";
    let seenOmitDev: boolean | undefined;
    const spyRunner: NpmAuditRunner = async (input): Promise<NpmRunOutcome> => {
      seenCwd = input.cwd;
      seenOmitDev = input.omitDev;
      return { kind: "output", stdout: '{"auditReportVersion":2}' };
    };

    const res = await collectAuditOutput(proj, { dev: false, runner: spyRunner });
    expect(res.kind).toBe("output");
    // Běželo to v dočasném adresáři, NE v projektu (izolace proti .npmrc).
    expect(seenCwd).not.toBe(proj);
    expect(path.dirname(seenCwd)).toBe(tmpdir());
    // dev:false → omitDev:true (jen produkční).
    expect(seenOmitDev).toBe(true);
    // Temp dir je po doběhnutí uklizený (žádný osiřelý stav).
    expect(await pathExists(seenCwd)).toBe(false);
  });

  it("dev:true → omitDev:false (zahrne i vývojové)", async () => {
    await writeFile(path.join(proj, "package.json"), "{}\n");
    await writeFile(path.join(proj, "package-lock.json"), "{}\n");
    let seenOmitDev: boolean | undefined;
    const spyRunner: NpmAuditRunner = async (input) => {
      seenOmitDev = input.omitDev;
      return { kind: "output", stdout: "{}" };
    };
    await collectAuditOutput(proj, { dev: true, runner: spyRunner });
    expect(seenOmitDev).toBe(false);
  });

  it("runner timeout → skip o časovém limitu", async () => {
    await writeFile(path.join(proj, "package.json"), "{}\n");
    await writeFile(path.join(proj, "package-lock.json"), "{}\n");
    const res = await collectAuditOutput(proj, {
      dev: false,
      runner: async () => ({ kind: "timeout" }),
    });
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("limit");
  });

  it("runner spawn-failed → skip nese původní důvod", async () => {
    await writeFile(path.join(proj, "package.json"), "{}\n");
    await writeFile(path.join(proj, "package-lock.json"), "{}\n");
    const res = await collectAuditOutput(proj, {
      dev: false,
      runner: async () => ({ kind: "spawn-failed", reason: "npm nenalezen v PATH" }),
    });
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("npm nenalezen");
  });
});
