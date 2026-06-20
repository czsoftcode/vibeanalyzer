import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// scanTree je sám defenzivní (chyby I/O sype do skippedUnreadable, nehodí), takže
// chybové větve úseku scan z reálného vstupu deterministicky nevyvoláme. Mockujeme
// tedy seam ./scan.js. POZOR: jen scanTree – ostatní exporty (ROOT_UNREADABLE_MARKER)
// musíme nechat reálné, protože cli.ts na ně váže guard; jinak by guard dostal
// undefined. Per-soubor mock, proto vlastní test soubor (globální by rozbil cli.test.ts).
vi.mock("./scan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scan.js")>();
  return { ...actual, scanTree: vi.fn() };
});

import { run } from "./cli.js";
import { ROOT_UNREADABLE_MARKER, scanTree } from "./scan.js";

const mockedScan = vi.mocked(scanTree);

// Necílí izolaci strojové vrstvy → in-process (bez forku): jinak by každý run()
// forkoval node + načítal typescript a paralelně se dusil (timeouty).
process.env.VIBE_ANALYSIS_INPROCESS = "1";

describe("run – chybové větve analýzy (scan/build)", () => {
  let proj: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-scan-"));
    await writeFile(path.join(proj, "index.ts"), "export const x = 1;\n", "utf8");
    errors = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      errors.push(String(msg));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    mockedScan.mockReset();
    await rm(proj, { recursive: true, force: true }).catch(() => {});
  });

  it("scanTree hodí → run() výjimku PROPAGUJE (nemaskuje jako I/O), launcher ji vezme", async () => {
    // Nález 3-11: scanTree na I/O nikdy nehodí; když hodí, je to programová chyba
    // a musí probublat se stackem do launcher catche v bin.ts, ne být spolknutá do
    // generické hlášky bez stacku. Tenhle test pin: re-přidání catche kolem
    // scanTree by run() přestalo nechat rejectnout → test padne.
    const err = new Error("programová chyba ve scanu");
    mockedScan.mockRejectedValueOnce(err);

    await expect(run([proj, "--out", path.join(proj, "out")], proj)).rejects.toThrow(
      "programová chyba ve scanu",
    );
  });

  it("nečitelný kořen (skippedUnreadable obsahuje marker) → exit 1 + outDir nevznikne", async () => {
    // simulace TOCTOU: cíl prošel validací, ale při scanu už nejde přečíst.
    // Hodnotu bereme ze sdílené konstanty – ať test sleduje kontrakt, ne literál.
    mockedScan.mockResolvedValueOnce({
      files: [],
      skippedUnreadable: [ROOT_UNREADABLE_MARKER],
      ignoredByGitignore: 0,
      gitignoreWarnings: [],
    });
    const outDir = path.join(proj, "out");

    const code = await run([proj, "--out", outDir], proj);

    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("cílovou složku nelze přečíst"))).toBe(true);
    // 3-12: guard běží PŘED mkdir, takže výstupní adresář nesmí vzniknout
    await expect(access(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("legitimně prázdná čitelná složka (skippedUnreadable prázdné) → exit 0, ne falešné selhání", async () => {
    // pojistka, že guard nepleteme: prázdný projekt je validní výsledek, ne chyba
    mockedScan.mockResolvedValueOnce({ files: [], skippedUnreadable: [], ignoredByGitignore: 0, gitignoreWarnings: [] });
    const outDir = path.join(proj, "out");

    const code = await run([proj, "--out", outDir], proj);

    expect(code).toBe(0);
    expect(errors.length).toBe(0);
    // happy path naopak outDir vytvořit MÁ (kontrast ke guard větvi)
    await expect(access(outDir)).resolves.toBeUndefined();
  });
});
