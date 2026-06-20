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
  let jsonPath: string;
  let mdPath: string;
  let jsonTmp: string;
  let mdTmp: string;
  // reálné implementace pro simulaci uvnitř mocku (mimo passthrough modul)
  let real: typeof import("node:fs/promises");

  beforeEach(async () => {
    real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    dir = await real.mkdtemp(path.join(tmpdir(), "vibe-write-"));
    jsonPath = path.join(dir, "out.json");
    mdPath = path.join(dir, "out.md");
    jsonTmp = `${jsonPath}.tmp`;
    mdTmp = `${mdPath}.tmp`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await real.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("zapíše oba soubory s obsahem a nenechá .tmp", async () => {
    await writeReportFiles(jsonPath, "{}\n", mdPath, "# md\n");

    expect(await real.readFile(jsonPath, "utf8")).toBe("{}\n");
    expect(await real.readFile(mdPath, "utf8")).toBe("# md\n");
    // dočasné soubory musí být přejmenované pryč
    expect(await exists(jsonTmp)).toBe(false);
    expect(await exists(mdTmp)).toBe(false);
  });

  it("2-7: selhání PRVNÍHO (JSON) zápisu nezničí cíle z minulého běhu", async () => {
    // simuluj report z předchozího běhu, který na cestách už leží
    await real.writeFile(jsonPath, "STARÝ JSON\n", "utf8");
    await real.writeFile(mdPath, "STARÝ MD\n", "utf8");

    // první zápis (do jsonTmp) vytvoří temp, pak selže – ke druhému se nedostaneme
    vi.spyOn(fsp, "writeFile").mockImplementationOnce(async (p) => {
      await real.writeFile(p as string, "", "utf8");
      const e = new Error("EFBIG: file too large") as NodeJS.ErrnoException;
      e.code = "EFBIG";
      throw e;
    });

    await expect(writeReportFiles(jsonPath, "{}\n", mdPath, "# md\n")).rejects.toMatchObject({
      code: "EFBIG",
    });

    // cílové soubory zůstaly nedotčené – starý report přežil
    expect(await real.readFile(jsonPath, "utf8")).toBe("STARÝ JSON\n");
    expect(await real.readFile(mdPath, "utf8")).toBe("STARÝ MD\n");
    // žádný osiřelý .tmp
    expect(await exists(jsonTmp)).toBe(false);
    expect(await exists(mdTmp)).toBe(false);
  });

  it("2-16: úspěšný JSON + pád MD nepřepíše cíl a nenechá half-pár", async () => {
    await real.writeFile(jsonPath, "STARÝ JSON\n", "utf8");
    await real.writeFile(mdPath, "STARÝ MD\n", "utf8");

    // JSON temp se zapíše celý, MD temp selže (ENOSPC) – žádný rename neproběhne
    let call = 0;
    vi.spyOn(fsp, "writeFile").mockImplementation(async (p, data) => {
      call++;
      if (call === 1) {
        await real.writeFile(p as string, data as string, "utf8");
        return;
      }
      await real.writeFile(p as string, "", "utf8");
      const e = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
      e.code = "ENOSPC";
      throw e;
    });

    await expect(writeReportFiles(jsonPath, "NOVÝ\n", mdPath, "# md\n")).rejects.toMatchObject({
      code: "ENOSPC",
    });

    // cíle zůstaly na starém obsahu – žádný nový half-pár (JSON nový + MD starý)
    expect(await real.readFile(jsonPath, "utf8")).toBe("STARÝ JSON\n");
    expect(await real.readFile(mdPath, "utf8")).toBe("STARÝ MD\n");
    expect(await exists(jsonTmp)).toBe(false);
    expect(await exists(mdTmp)).toBe(false);
  });

  it("selhání zápisu bez existujícího cíle nezanechá žádný výstup ani .tmp", async () => {
    // žádné předchozí soubory na cestách
    vi.spyOn(fsp, "writeFile").mockImplementation(async (p) => {
      await real.writeFile(p as string, "", "utf8"); // temp vznikne
      const e = new Error("EIO: i/o error") as NodeJS.ErrnoException;
      e.code = "EIO";
      throw e;
    });

    await expect(writeReportFiles(jsonPath, "{}\n", mdPath, "# md\n")).rejects.toMatchObject({
      code: "EIO",
    });

    expect(await exists(jsonPath)).toBe(false);
    expect(await exists(mdPath)).toBe(false);
    expect(await exists(jsonTmp)).toBe(false);
    expect(await exists(mdTmp)).toBe(false);
  });

  it("selhání DRUHÉHO renamu (EISDIR na MD): zbytkové okno – JSON přejmenován, žádný .tmp", async () => {
    // mdPath je adresář → rename(mdTmp → mdPath) selže EISDIR; JSON rename ale projde
    await real.writeFile(jsonPath, "STARÝ JSON\n", "utf8");
    await real.mkdir(mdPath, { recursive: true });

    await expect(writeReportFiles(jsonPath, "NOVÝ JSON\n", mdPath, "# md\n")).rejects.toMatchObject({
      code: "EISDIR",
    });

    // VĚDOMÁ zbytková neúplná atomicita: první rename uspěl, takže JSON je už nový;
    // rollback nejde (starý obsah přepsán). Tohle okno dokumentuje docstring.
    expect(await real.readFile(jsonPath, "utf8")).toBe("NOVÝ JSON\n");
    // úklid nesmí nechat .tmp (jsonTmp už přejmenován pryč, mdTmp se uklidil)
    expect(await exists(jsonTmp)).toBe(false);
    expect(await exists(mdTmp)).toBe(false);
  });
});
