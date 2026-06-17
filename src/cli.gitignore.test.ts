import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";

// End-to-end: cli → loadGitignore → scanTree. Ověřuje, že kořenový .gitignore
// reálně prořeže výstup (Symfony vendor/, var/cache/) a že bez .gitignore je
// výstup beze změny. Jednotka loadGitignore i scanTree jsou pokryty zvlášť;
// tohle hlídá, že je cli opravdu propojí (smazání napojení = padlý test).
describe("run – respektuje kořenový .gitignore", () => {
  let proj: string;
  let outDir: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-gi-"));
    outDir = path.join(proj, "report");
    // běžný projekt
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(path.join(proj, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await writeFile(path.join(proj, "README.md"), "# demo\n", "utf8");
    // to, co u Symfony bere cache/vendor
    await mkdir(path.join(proj, "vendor", "pkg"), { recursive: true });
    await writeFile(path.join(proj, "vendor", "pkg", "autoload.php"), "<?php\n", "utf8");
    await mkdir(path.join(proj, "var", "cache"), { recursive: true });
    await writeFile(path.join(proj, "var", "cache", "app.php"), "<?php\n", "utf8");

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

  async function readReportMd(): Promise<string> {
    const outFiles = await readdir(outDir);
    const mdName = outFiles.find((f) => f.endsWith(".md"));
    expect(mdName).toBeDefined();
    return readFile(path.join(outDir, mdName as string), "utf8");
  }

  it("s .gitignore (vendor/, var/cache/) tyto cesty z reportu zmizí, zbytek zůstane", async () => {
    await writeFile(path.join(proj, ".gitignore"), "vendor/\nvar/cache/\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const paths = await readIndexPaths();
    // ignorované cesty nejsou v indexu (ani složka, ani obsah – prořezáno)
    expect(paths.some((p) => p === "vendor" || p.startsWith("vendor/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("var/cache"))).toBe(false);
    // běžné soubory zůstávají
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("README.md");
    // var sám zůstává (ignorovali jsme jen var/cache)
    expect(paths).toContain("var");

    // a v MD reportu se ignorovaný obsah neobjeví
    const md = await readReportMd();
    expect(md).not.toContain("autoload.php");
  });

  it("bez .gitignore: výstup beze změny (vendor/var se zaindexují)", async () => {
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const paths = await readIndexPaths();
    // bez .gitignore se nic navíc nefiltruje – vendor i var/cache jsou v indexu
    expect(paths).toContain("vendor");
    expect(paths).toContain("vendor/pkg/autoload.php");
    expect(paths).toContain("var/cache/app.php");
    expect(paths).toContain("src/index.ts");
    // a žádné upozornění na prázdný index
    expect(errors.length).toBe(0);
  });

  it(".gitignore se vzorem '*' odfiltruje vše → exit 0, report vznikne, upozornění na stderr", async () => {
    await writeFile(path.join(proj, ".gitignore"), "*\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    // report se PŘESTO vyrobí a vrací úspěch (kořen je čitelný), jen prázdný
    expect(code).toBe(0);

    const paths = await readIndexPaths();
    expect(paths).toEqual([]);
    // ale ne potichu: na stderr je upozornění, že .gitignore odfiltroval vše
    expect(errors.some((e) => e.includes("odfiltroval všechny"))).toBe(true);
  });

  it("patologicky dlouhá řádka v .gitignore → upozornění, scan poběží bez něj, exit 0 (ne pád) [6-1]", async () => {
    // řádka přes strop: bez ošetření by matcher v ignores() hodil, scanTree promise
    // odmítl a celá analýza spadla. Musí degradovat nahlas, ne spadnout.
    await writeFile(path.join(proj, ".gitignore"), `${"a".repeat(40000)}\n`, "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    // .gitignore se nepoužil → vendor je v indexu (nefiltrovalo se)
    const paths = await readIndexPaths();
    expect(paths).toContain("vendor");
    expect(paths).toContain("src/index.ts");
    // a degradace se hlásí nahlas
    expect(errors.some((e) => e.includes("nejde zpracovat"))).toBe(true);
  });

  it("vzor jen na soubory smaže VŠECHNY soubory → varování, i když složky zůstanou [6-3]", async () => {
    // .gitignore je sám soubor → musí se ignorovat taky, jinak by zůstal v indexu
    // jako jediný soubor a fileCount by nebyl 0 (legitimní config soubor).
    await writeFile(path.join(proj, ".gitignore"), ".gitignore\n*.ts\n*.md\n*.php\n", "utf8");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const paths = await readIndexPaths();
    // ani jeden soubor v indexu...
    expect(paths).not.toContain("src/index.ts");
    expect(paths).not.toContain("README.md");
    expect(paths.some((p) => p.endsWith(".php"))).toBe(false);
    // ...ale složky zůstaly (proto files.length > 0 – stará podmínka by mlčela)
    expect(paths).toContain("src");
    // varování přesto zaznělo (počítá se na soubory, ne na položky)
    expect(errors.some((e) => e.includes("neobsahuje jediný soubor"))).toBe(true);
  });

  it("READ-ONLY: běh nezapíše nic do analyzovaného projektu (výstup jde do --out mimo něj)", async () => {
    await writeFile(path.join(proj, ".gitignore"), "vendor/\n", "utf8");

    // rekurzivní soupis projektu před během
    async function listTree(dir: string, base = dir): Promise<string[]> {
      const ents = await readdir(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const e of ents) {
        const abs = path.join(dir, e.name);
        out.push(path.relative(base, abs));
        if (e.isDirectory()) out.push(...(await listTree(abs, base)));
      }
      return out.sort();
    }

    const before = await listTree(proj);

    // výstup ZÁMĚRNĚ mimo analyzovaný projekt
    const externalOut = await mkdtemp(path.join(tmpdir(), "vibe-out-"));
    const code = await run([proj, "--out", externalOut], proj);
    await rm(externalOut, { recursive: true, force: true }).catch(() => {});
    expect(code).toBe(0);

    const after = await listTree(proj);
    // do analyzovaného stromu nic nepřibylo ani nezmizelo
    expect(after).toEqual(before);
  });

  it("nečitelný .gitignore (je to adresář) → upozornění, scan poběží bez něj, exit 0", async () => {
    await mkdir(path.join(proj, ".gitignore"), { recursive: true });

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    // bez platného .gitignore se nefiltruje → vendor je zpět v indexu
    const paths = await readIndexPaths();
    expect(paths).toContain("vendor");
    // a degradace se hlásí nahlas
    expect(errors.some((e) => e.includes("nešel přečíst") && e.includes("EISDIR"))).toBe(true);
  });
});
