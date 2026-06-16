import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Selhání zápisu reportu nejde pod rootem spolehlivě vyvolat přes FS práva
// (chmod se obejde), proto mockujeme seam writeReportFiles, ať vyhodí
// ErrnoException. Mock je per-soubor (vi.mock hoistuje na začátek modulu),
// proto vlastní test soubor – jinak by rozbil integrační test v cli.test.ts,
// který spoléhá na reálný zápis výstupů.
vi.mock("./report/writeOutputs.js", () => ({
  writeReportFiles: vi.fn(async () => {
    const err = new Error("no space left on device") as NodeJS.ErrnoException;
    err.code = "ENOSPC";
    throw err;
  }),
}));

import { run } from "./cli.js";

describe("run – selhání zápisu reportu → exit 1 (ne pád)", () => {
  let proj: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-write-"));
    await writeFile(path.join(proj, "index.ts"), "export const x = 1;\n", "utf8");
    errors = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      errors.push(String(msg));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(proj, { recursive: true, force: true }).catch(() => {});
  });

  it("writeReportFiles vyhodí ErrnoException → run() vrátí 1 a vypíše hlášku", async () => {
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);

    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("výstup nelze zapsat"))).toBe(true);
    expect(errors.some((e) => e.includes("ENOSPC"))).toBe(true);
    // 3-10: outDir, který jsme kvůli zápisu vytvořili, se má uklidit
    // (mkdir vrátil cestu → rm ji odstraní)
    await expect(access(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("při selhání zápisu NEsmaže neprázdný outDir (staré reporty zůstanou)", async () => {
    const outDir = path.join(proj, "report");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "starý-report.md"), "# starý\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);

    expect(code).toBe(1);
    // nemažeme, cos nevytvořil (mkdir vrátil undefined) → starý obsah přežije
    await expect(access(path.join(outDir, "starý-report.md"))).resolves.toBeUndefined();
  });

  it("3-14: předem existující PRÁZDNÝ uživatelův outDir při selhání zápisu PŘEŽIJE", async () => {
    const outDir = path.join(proj, "muj-prazdny-adresar");
    await mkdir(outDir, { recursive: true }); // uživatel ho vytvořil, ne nástroj

    const code = await run([proj, "--out", outDir], proj);

    expect(code).toBe(1);
    // mkdir vrátil undefined (existoval) → nesmíme ho smazat, i když je prázdný
    await expect(access(outDir)).resolves.toBeUndefined();
  });

  it("3-15: zanořený --out → při selhání zápisu se uklidí i vytvořené mezičlánky", async () => {
    // a ani b neexistují → mkdir -p vytvoří a/b/report; po selhání nesmí zůstat
    // žádný z nich (osiřelé prázdné rodiče)
    const outDir = path.join(proj, "a", "b", "report");

    const code = await run([proj, "--out", outDir], proj);

    expect(code).toBe(1);
    // nejvyšší vytvořená cesta byla proj/a → smazána rekurzivně i s b/report
    await expect(access(path.join(proj, "a"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
