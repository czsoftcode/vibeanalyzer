import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeReportFiles } from "./writeOutputs.js";

// node:fs/promises mockujeme jako passthrough (kopie reálného modulu) – jen aby
// šel writeFile přepsat spy-em; ostatní funkce volají reálnou implementaci.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual };
});

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("writeReportFiles", () => {
  let dir: string;
  // reálné implementace pro simulaci uvnitř mocku (mimo passthrough modul)
  let real: typeof import("node:fs/promises");

  beforeEach(async () => {
    real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    dir = await real.mkdtemp(path.join(tmpdir(), "vibe-write-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await real.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("zapíše oba soubory s obsahem", async () => {
    const jsonPath = path.join(dir, "out.json");
    const mdPath = path.join(dir, "out.md");
    await writeReportFiles(jsonPath, "{}\n", mdPath, "# md\n");

    expect(await real.readFile(jsonPath, "utf8")).toBe("{}\n");
    expect(await real.readFile(mdPath, "utf8")).toBe("# md\n");
  });

  it("selhání MD zápisu PO vytvoření souboru (ENOSPC) → žádný osiřelý JSON ani MD", async () => {
    const jsonPath = path.join(dir, "out.json");
    const mdPath = path.join(dir, "out.md");

    // simuluj realistický spouštěč: open uspěje (soubor vznikne), write selže
    let call = 0;
    vi.spyOn(fsp, "writeFile").mockImplementation(async (p) => {
      call++;
      await real.writeFile(p as string, "", "utf8"); // soubor vznikne na disku
      if (call === 2) {
        const e = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
        e.code = "ENOSPC";
        throw e;
      }
    });

    await expect(writeReportFiles(jsonPath, "{}\n", mdPath, "# md\n")).rejects.toMatchObject({
      code: "ENOSPC",
    });

    // oba soubory open-em vznikly, ale catch je musí uklidit – žádný osiřelý výstup
    expect(await exists(jsonPath)).toBe(false);
    expect(await exists(mdPath)).toBe(false);
  });

  it("selhání PRVNÍHO (JSON) zápisu po vytvoření → JSON uklizen, MD nevznikl", async () => {
    const jsonPath = path.join(dir, "out.json");
    const mdPath = path.join(dir, "out.md");

    vi.spyOn(fsp, "writeFile").mockImplementationOnce(async (p) => {
      await real.writeFile(p as string, "", "utf8"); // JSON vznikne
      const e = new Error("EFBIG: file too large") as NodeJS.ErrnoException;
      e.code = "EFBIG";
      throw e;
    });

    await expect(writeReportFiles(jsonPath, "{}\n", mdPath, "# md\n")).rejects.toMatchObject({
      code: "EFBIG",
    });

    expect(await exists(jsonPath)).toBe(false);
    expect(await exists(mdPath)).toBe(false);
  });

  it("EISDIR (selhání už při open) také nezanechá nic", async () => {
    const jsonPath = path.join(dir, "out.json");
    const mdPath = path.join(dir, "out.md");
    await real.mkdir(mdPath, { recursive: true }); // MD cesta je adresář → EISDIR při open

    await expect(writeReportFiles(jsonPath, "{}\n", mdPath, "# md\n")).rejects.toMatchObject({
      code: "EISDIR",
    });

    expect(await exists(jsonPath)).toBe(false);
  });
});
