import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Reálný integrační test spustitelnosti binárky PŘES SYMLINK – přesně to, jak
// npm instaluje `bin`. In-process test isEntrypoint to neověří (musí běžet jako
// main modul reálného node procesu). Tohle chytí regresi tichého no-opu, kterou
// jednotkové testy nechytnou (blocker 2-12 prošel "vitest run" zeleně).
const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const distCli = path.join(projectRoot, "dist", "cli.js");

describe("CLI vstupní bod přes symlink (npm bin)", () => {
  let linkDir: string;
  let link: string;

  beforeAll(async () => {
    // build je nutný – test běží proti reálnému dist/cli.js, ne přes tsx
    execFileSync("npm", ["run", "build"], { cwd: projectRoot, stdio: "ignore" });
    linkDir = await mkdtemp(path.join(tmpdir(), "vibe-bin-"));
    link = path.join(linkDir, "vibeanalyzer");
    await symlink(distCli, link);
  }, 120000);

  afterAll(async () => {
    await rm(linkDir, { recursive: true, force: true }).catch(() => {});
  });

  it("spuštění přes symlink vypíše výstup (ne tichý no-op)", () => {
    const out = execFileSync("node", [link, "--help"], { encoding: "utf8" });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("VibeAnalyzer");
  });
});
