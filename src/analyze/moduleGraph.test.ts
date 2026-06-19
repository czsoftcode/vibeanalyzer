import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMinifiedName } from "../minified.js";
import type { FileEntry } from "../scan.js";
import { buildModuleGraph, type ModuleGraphResult } from "./moduleGraph.js";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-mgraph-"));
});
afterEach(async () => {
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

/** Zapíše soubor a vrátí jeho FileEntry (jako by ze scanu). */
async function put(rel: string, content: string): Promise<FileEntry> {
  const abs = path.join(proj, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return {
    path: rel,
    type: "file",
    ext: path.extname(rel).toLowerCase(),
    size: Buffer.byteLength(content),
    depth: rel.split("/").length,
    minified: isMinifiedName(rel.split("/").pop() ?? rel),
  };
}

function asRan(r: ModuleGraphResult): Extract<ModuleGraphResult, { kind: "ran" }> {
  if (r.kind !== "ran") throw new Error(`čekal jsem ran, dostal ${r.kind}`);
  return r;
}

describe("buildModuleGraph", () => {
  it("HLAVNÍ PAST: ./b.js z a.ts se napojí na reálný b.ts (hrana sedí)", async () => {
    const files = [
      await put("src/a.ts", `import { b } from "./b.js";\nexport const a = b;\n`),
      await put("src/b.ts", `export const b = 1;\n`),
    ];
    const r = asRan(await buildModuleGraph(proj, files));
    expect(r.edges).toEqual([{ from: "src/a.ts", to: "src/b.ts" }]);
    expect(r.fileCount).toBe(2);
    expect(r.isolated).toEqual([]); // oba jsou v hraně
  });

  it("minifikát se nestane uzlem/hranou, počítá se zvlášť (minified, ne fileCount)", async () => {
    const files = [
      // reálný zdroják importuje knihovnu i bundle; hrana do bundlu se NEvykreslí
      await put("src/a.ts", `import { x } from "./lib.js";\nimport "./vendor.min.js";\nexport const a = x;\n`),
      await put("src/lib.ts", `export const x = 1;\n`),
      await put("src/vendor.min.js", `var v=1;\n`), // malý → velikostní strop by ho minul
      await put("src/app.min.js", `var a=1;\n`), // osamělý minifikát
    ];
    const r = asRan(await buildModuleGraph(proj, files));

    expect(r.minified).toBe(2); // vendor.min.js + app.min.js, podle JMÉNA
    expect(r.tooLarge).toBe(0); // nejde o velikost
    expect(r.fileCount).toBe(2); // parsovaly se jen a.ts a lib.ts
    // jediná hrana je do reálné knihovny; import do .min.js vypadl (není ve scanned)
    expect(r.edges).toEqual([{ from: "src/a.ts", to: "src/lib.ts" }]);
    // minifikáty nejsou ani uzel, ani 'isolated'
    expect(r.isolated).toEqual([]);
    expect(r.edges.some((e) => e.to.endsWith(".min.js") || e.from.endsWith(".min.js"))).toBe(false);
  });

  it("soubor bez hran je 'isolated', ne v grafu", async () => {
    const files = [
      await put("src/a.ts", `import { b } from "./b.js";\n`),
      await put("src/b.ts", `export const b = 1;\n`),
      await put("src/lonely.ts", `export const x = 1;\n`),
    ];
    const r = asRan(await buildModuleGraph(proj, files));
    expect(r.edges).toEqual([{ from: "src/a.ts", to: "src/b.ts" }]);
    expect(r.isolated).toEqual(["src/lonely.ts"]);
  });

  it("externí balík ani neexistující relativní cíl nedají hranu", async () => {
    const files = [
      await put("src/a.ts", `import x from "react";\nimport y from "./chybi.js";\nexport const a = 1;\n`),
    ];
    const r = asRan(await buildModuleGraph(proj, files));
    expect(r.edges).toEqual([]);
    expect(r.isolated).toEqual(["src/a.ts"]);
  });

  it("dvojí import téhož modulu = jedna hrana; non-source soubory se ignorují", async () => {
    const files = [
      await put("src/a.ts", `import { x } from "./b.js";\nimport { y } from "./b.js";\n`),
      await put("src/b.ts", `export const x = 1;\nexport const y = 2;\n`),
      await put("README.md", `# není modul\n`),
    ];
    const r = asRan(await buildModuleGraph(proj, files));
    expect(r.edges).toEqual([{ from: "src/a.ts", to: "src/b.ts" }]);
    expect(r.fileCount).toBe(2); // README.md se nečetl
  });

  it("nečitelný soubor (zmizel mezi scanem a čtením) se přeskočí, nespadne", async () => {
    const real = await put("src/b.ts", `export const b = 1;\n`);
    // FileEntry na soubor, který fyzicky neexistuje → readFile selže → unreadable++
    const ghost: FileEntry = { path: "src/ghost.ts", type: "file", ext: ".ts", size: 10, depth: 2, minified: false };
    const r = asRan(await buildModuleGraph(proj, [ghost, real]));
    expect(r.unreadable).toBe(1);
    expect(r.fileCount).toBe(1);
    expect(r.kind).toBe("ran"); // jeden nečitelný neshodí vrstvu
  });

  // Fake `ts`, kde createSourceFile hodí zadanou výjimku; ScriptTarget/ScriptKind
  // musí existovat, jinak by extractRelativeSpecifiers padl dřív na nich.
  function tsThrowing(err: Error): typeof import("typescript") {
    return {
      ScriptTarget: { Latest: 99 },
      ScriptKind: { TS: 3, TSX: 4, JSX: 2, JS: 1 },
      createSourceFile: () => {
        throw err;
      },
    } as unknown as typeof import("typescript");
  }

  it("RangeError z parseru (přetečení zásobníku) = unparsable, ne pád", async () => {
    const files = [await put("src/a.ts", `export const a = 1;\n`)];
    const fakeTs = tsThrowing(new RangeError("Maximum call stack size exceeded"));
    const r = asRan(
      await buildModuleGraph(proj, files, { loadTs: async () => ({ ts: fakeTs, version: "x" }) }),
    );
    expect(r.unparsable).toBe(1);
    expect(r.fileCount).toBe(0);
  });

  it("PROGRAMOVÁ chyba z parseru (TypeError) NEní maskována jako unparsable – probublá", async () => {
    const files = [await put("src/a.ts", `export const a = 1;\n`)];
    const fakeTs = tsThrowing(new TypeError("bug v parseru"));
    await expect(
      buildModuleGraph(proj, files, { loadTs: async () => ({ ts: fakeTs, version: "x" }) }),
    ).rejects.toThrow("bug v parseru");
  });

  it("loadTs selže → celá vrstva 'skipped' s důvodem, ne pád", async () => {
    const files = [await put("src/a.ts", `export const a = 1;\n`)];
    const r = await buildModuleGraph(proj, files, {
      loadTs: async () => {
        throw new Error("parser nedostupný");
      },
    });
    expect(r.kind).toBe("skipped");
    if (r.kind === "skipped") expect(r.reason).toContain("parser nedostupný");
  });

  it("projekt bez zdrojových souborů → ran s prázdným grafem (ne skipped)", async () => {
    const files = [await put("README.md", `# nic\n`)];
    const r = asRan(await buildModuleGraph(proj, files));
    expect(r.edges).toEqual([]);
    expect(r.isolated).toEqual([]);
    expect(r.fileCount).toBe(0);
  });
});
