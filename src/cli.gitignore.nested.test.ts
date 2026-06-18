import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";

// End-to-end fáze 7: cli → reálný loadDirIgnore → scanTree se zásobníkem matcherů.
// Ověřuje vnořená pravidla, re-include přes ! napříč úrovněmi (vč. kořene), git
// gotcha (prořezaná složka ! neoživí) a degradaci vnořeného .gitignore. Jednotky
// (loadDirIgnore, scanTree, ignoredByStack) jsou pokryté zvlášť; tohle hlídá, že
// to cli reálně propojí přes skutečnou knihovnu `ignore`.
// Necílí izolaci strojové vrstvy → in-process (bez forku, rychlé).
process.env.VIBE_ANALYSIS_INPROCESS = "1";

describe("run – respektuje vnořené .gitignore", () => {
  let proj: string;
  let outDir: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-nested-"));
    outDir = path.join(proj, "report");
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

  async function readIndexPaths(): Promise<string[]> {
    const outFiles = await readdir(outDir);
    const jsonName = outFiles.find((f) => f.endsWith(".json"));
    expect(jsonName).toBeDefined();
    const index = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
    return index.files.map((f: { path: string }) => f.path);
  }

  it("kanonický příklad fáze: src/*.log ignoruje, src/sub/!keep.log re-include", async () => {
    await mkdir(path.join(proj, "src", "sub"), { recursive: true });
    await writeFile(path.join(proj, "src", ".gitignore"), "*.log\n", "utf8");
    await writeFile(path.join(proj, "src", "sub", ".gitignore"), "!keep.log\n", "utf8");
    await writeFile(path.join(proj, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await writeFile(path.join(proj, "src", "a.log"), "x\n", "utf8");
    await writeFile(path.join(proj, "src", "sub", "b.log"), "x\n", "utf8");
    await writeFile(path.join(proj, "src", "sub", "keep.log"), "x\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const paths = await readIndexPaths();
    expect(paths).not.toContain("src/a.log"); // src/.gitignore *.log
    expect(paths).not.toContain("src/sub/b.log"); // *.log platí i v podstromu
    expect(paths).toContain("src/sub/keep.log"); // re-include z hlubší úrovně
    expect(paths).toContain("src/index.ts"); // nesouvisející soubor zůstal
    expect(errors).toEqual([]); // žádná degradace
  });

  it("re-include funguje i NAPŘÍČ kořenem: root/*.log + src/!debug.log", async () => {
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(path.join(proj, ".gitignore"), "*.log\n", "utf8");
    await writeFile(path.join(proj, "src", ".gitignore"), "!debug.log\n", "utf8");
    await writeFile(path.join(proj, "a.log"), "x\n", "utf8");
    await writeFile(path.join(proj, "src", "other.log"), "x\n", "utf8");
    await writeFile(path.join(proj, "src", "debug.log"), "x\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const paths = await readIndexPaths();
    expect(paths).not.toContain("a.log"); // kořenové *.log
    expect(paths).not.toContain("src/other.log"); // kořenové *.log i hlouběji
    expect(paths).toContain("src/debug.log"); // hlubší !debug.log přebíjí kořen
  });

  it("git gotcha: pod PROŘEZANÝM adresářem ! soubor NEOŽIVÍ (složka se nečte)", async () => {
    // root ignoruje celou cache/ → scanTree do ní nevstoupí, takže cache/.gitignore
    // se vůbec nepřečte a !important.txt nemá jak zabrat (přesně jako Git).
    await mkdir(path.join(proj, "cache"), { recursive: true });
    await writeFile(path.join(proj, ".gitignore"), "cache/\n", "utf8");
    await writeFile(path.join(proj, "cache", ".gitignore"), "!important.txt\n", "utf8");
    await writeFile(path.join(proj, "cache", "important.txt"), "x\n", "utf8");
    await writeFile(path.join(proj, "README.md"), "# demo\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const paths = await readIndexPaths();
    expect(paths.some((p) => p === "cache" || p.startsWith("cache/"))).toBe(false);
    expect(paths).toContain("README.md");
  });

  it("degradace vnořené úrovně: nečitelný src/.gitignore → varování, podstrom se projde, pravidla PŘEDKŮ platí", async () => {
    // src/.gitignore jako ADRESÁŘ → EISDIR (degradace té jedné úrovně). Kořenové
    // pravidlo 'secret.txt' ale dál platí i na src/secret.txt.
    await mkdir(path.join(proj, "src", ".gitignore"), { recursive: true });
    await writeFile(path.join(proj, ".gitignore"), "secret.txt\n", "utf8");
    await writeFile(path.join(proj, "src", "app.ts"), "export const y = 2;\n", "utf8");
    await writeFile(path.join(proj, "src", "secret.txt"), "TOP\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    // degradace nahlas, per-soubor, s cestou a kódem
    expect(
      errors.some(
        (e) =>
          e.includes("nešel přečíst") &&
          e.includes("EISDIR") &&
          e.includes(path.join(proj, "src", ".gitignore")),
      ),
    ).toBe(true);

    const paths = await readIndexPaths();
    expect(paths).toContain("src/app.ts"); // podstrom se PŘESTO prošel
    expect(paths).not.toContain("src/secret.txt"); // kořenové pravidlo přežilo degradaci dítěte
  });

  it("patologicky dlouhá řádka ve vnořeném .gitignore → varování, scan poběží dál (ne pád)", async () => {
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(path.join(proj, "src", ".gitignore"), `${"a".repeat(40000)}\n`, "utf8");
    await writeFile(path.join(proj, "src", "app.ts"), "export const z = 3;\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    expect(
      errors.some(
        (e) => e.includes("nejde zpracovat") && e.includes(path.join(proj, "src", ".gitignore")),
      ),
    ).toBe(true);
    const paths = await readIndexPaths();
    expect(paths).toContain("src/app.ts");
  });
});
