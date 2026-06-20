import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mockujeme seam writeReportFiles tak, aby vyhodil REÁLNOU ReportPathCollisionError.
// Třídu re-exportujeme z reálného modulu (importActual) → cli.ts (importuje z TÉHOŽ
// mockovaného modulu) i tenhle test sdílí JEDNU referenci třídy. Bez toho by
// instanceof v cli.ts porovnával proti jiné třídě a zuby by byly falešné.
vi.mock("./report/writeOutputs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./report/writeOutputs.js")>();
  return {
    ReportPathCollisionError: actual.ReportPathCollisionError,
    writeReportFiles: vi.fn(async () => {
      throw new actual.ReportPathCollisionError("kolize výstupních cest (test)");
    }),
  };
});

import { run } from "./cli.js";
import { ReportPathCollisionError } from "./report/writeOutputs.js";

// Necílí izolaci strojové vrstvy → in-process (bez forku, rychlé).
process.env.VIBE_ANALYSIS_INPROCESS = "1";

describe("run – kolize cest (ReportPathCollisionError) je programátorská chyba, ne I/O", () => {
  let proj: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-collide-"));
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

  it("run() ji NEzploští na exit 1, nechá ji probublat (rejects toutéž třídou)", async () => {
    const outDir = path.join(proj, "report");
    // KONKRÉTNÍ třída, ne libovolná chyba: bez opravy by kolize spadla do I/O větve,
    // run() by vrátil 1 (resolve) → rejects padne. To jsou zuby.
    await expect(run([proj, "--out", outDir], proj)).rejects.toBeInstanceOf(ReportPathCollisionError);
    // a NEsmí se maskovat jako I/O hláška
    expect(errors.some((e) => e.includes("výstup nelze zapsat"))).toBe(false);
  });

  it("vytvořený prázdný outDir se po kolizi uklidí (nález 3-9)", async () => {
    const outDir = path.join(proj, "report");
    await expect(run([proj, "--out", outDir], proj)).rejects.toBeInstanceOf(ReportPathCollisionError);
    // kolize hází PŘED zápisem → outDir je prázdný a vytvořili jsme ho my → smazat
    await expect(access(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("předem existující prázdný uživatelův outDir po kolizi PŘEŽIJE (nemažeme cizí)", async () => {
    const outDir = path.join(proj, "muj-adresar");
    await mkdir(outDir, { recursive: true }); // vytvořil uživatel, ne nástroj

    await expect(run([proj, "--out", outDir], proj)).rejects.toBeInstanceOf(ReportPathCollisionError);
    // mkdir vrátil undefined (existoval) → createdDir undefined → nemažeme nic
    await expect(access(outDir)).resolves.toBeUndefined();
  });
});
