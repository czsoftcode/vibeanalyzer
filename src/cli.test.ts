import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";

// Integrační test napojení cli → scanTree(excludePaths). Jednotkové scan testy
// ověřují MECHANISMUS izolovaně; tohle hlídá, že cli ten Set opravdu předá –
// jinak by smazání jednoho řádku v cli.ts prošlo bez padlého testu a výstupní
// adresář by se zase začal indexovat (regrese cíle 1-1).
describe("run – integrace cli s vyloučením outDir", () => {
  let proj: string;

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-"));
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(path.join(proj, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await writeFile(path.join(proj, "README.md"), "# demo\n", "utf8");
    // utlumit výstup CLI, ať netříští log testů
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(proj, { recursive: true, force: true }).catch(() => {});
  });

  it("výstupní adresář uvnitř analyzované složky se nezaindexuje", async () => {
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const outFiles = await readdir(outDir);
    const jsonName = outFiles.find((f) => f.endsWith(".json"));
    expect(jsonName).toBeDefined();

    const index = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
    const paths: string[] = index.files.map((f: { path: string }) => f.path);

    // zdrojové soubory ano, výstupní adresář ne
    expect(paths).toContain("src/index.ts");
    expect(paths.some((p) => p === "report" || p.startsWith("report/"))).toBe(false);
  });
});

describe("run – chybové větve vrací exit 1 (ne pád, ne tiché 0)", () => {
  let proj: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-err-"));
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

  it("neplatný cíl (neexistující cesta) → exit 1 s jasnou hláškou", async () => {
    const code = await run([path.join(proj, "tady-nic-neni")], proj);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("Cesta neexistuje"))).toBe(true);
  });

  it("selhání mkdir (--out uvnitř souboru → ENOTDIR) → exit 1", async () => {
    const blocker = path.join(proj, "blocker");
    await writeFile(blocker, "jsem soubor, ne adresář\n", "utf8");
    // outDir leží UVNITŘ souboru → mkdir recursive narazí na ENOTDIR
    const outDir = path.join(blocker, "report");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("výstupní adresář nelze vytvořit"))).toBe(true);
    expect(errors.some((e) => e.includes("ENOTDIR"))).toBe(true);
  });
});
