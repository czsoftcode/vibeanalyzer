import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEntrypoint, run } from "./cli.js";

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

describe("isEntrypoint – rozpoznání vstupního bodu i přes symlink", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vibe-entry-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("symlink na modul (npm bin) se rozpozná jako vstupní bod", async () => {
    const realFile = path.join(dir, "cli.js");
    await writeFile(realFile, "// modul\n", "utf8");
    const link = path.join(dir, "vibeanalyzer"); // jako npm bin symlink
    await symlink(realFile, link);

    // argv[1] = symlink, import.meta.url = realpath modulu (jako u main modulu v node)
    expect(isEntrypoint(link, pathToFileURL(realFile).href)).toBe(true);
  });

  it("cizí soubor jako argv[1] NENÍ vstupní bod (import z testu)", async () => {
    const realFile = path.join(dir, "cli.js");
    const other = path.join(dir, "vitest-runner.js");
    await writeFile(realFile, "// modul\n", "utf8");
    await writeFile(other, "// runner\n", "utf8");

    expect(isEntrypoint(other, pathToFileURL(realFile).href)).toBe(false);
  });

  it("chybějící argv[1] → false", () => {
    expect(isEntrypoint(undefined, pathToFileURL(path.join(dir, "cli.js")).href)).toBe(false);
  });
});
