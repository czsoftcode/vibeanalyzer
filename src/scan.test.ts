import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirIgnoreResult } from "./gitignore.js";
import { ROOT_UNREADABLE_MARKER, scanTree } from "./scan.js";

// node:fs/promises mockujeme jako passthrough (kopie reálného modulu), aby šel
// readdir/lstat přepsat spy-em pro simulaci DT_UNKNOWN / zvláštních typů, které
// se na běžném FS nedají vynutit. Ostatní funkce volají reálnou implementaci.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual };
});

// Je mkfifo k dispozici? Když ne (jiná platforma / omezené prostředí), test
// pro zvláštní typy se VIDITELNĚ skipne (it.skipIf), ne aby falešně "prošel"
// bez jediné assertion. Portovatelné pokrytí té větve řeší mock-test níž.
let hasMkfifo = true;
try {
  execFileSync("sh", ["-c", "command -v mkfifo"], { stdio: "ignore" });
} catch {
  hasMkfifo = false;
}

// Dirent, který svůj typ NEoznačí (jako DT_UNKNOWN na FS bez d_type). scanTree
// z něj čte jen name + is*() predikáty.
function unknownDirent(name: string): import("node:fs").Dirent {
  return {
    name,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => false,
  } as unknown as import("node:fs").Dirent;
}

// stat zvláštního typu (fifo/socket/device): ani symlink, ani dir, ani file.
function specialStat(): import("node:fs").Stats {
  return {
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => false,
  } as unknown as import("node:fs").Stats;
}

// stat symlinku – pro větev DT_UNKNOWN → lstat zjistí symlink.
function symlinkStat(): import("node:fs").Stats {
  return {
    isSymbolicLink: () => true,
    isDirectory: () => false,
    isFile: () => false,
  } as unknown as import("node:fs").Stats;
}

describe("scanTree", () => {
  let root: string;
  // reálné implementace pro použití uvnitř mocků (mimo passthrough modul)
  let real: typeof import("node:fs/promises");

  beforeEach(async () => {
    real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    root = await mkdtemp(path.join(tmpdir(), "vibe-scan-"));
    // běžný projekt
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await writeFile(path.join(root, "README.md"), "# projekt\n", "utf8");
    // pomocné složky, které se mají přeskočit
    await mkdir(path.join(root, "node_modules", "leftpad"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "leftpad", "index.js"), "// dep\n", "utf8");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, ".git", "HEAD"), "ref\n", "utf8");
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.js"), "// build\n", "utf8");
    // vlastní výstup nástroje
    await writeFile(path.join(root, "vibeanalyzer-2026-06-15T00-00-00-000Z.json"), "{}\n", "utf8");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("zahrne vlastní soubory a vynechá pomocné složky a vlastní výstup", async () => {
    const { files } = await scanTree(root);
    const paths = files.map((f) => f.path).sort();

    expect(paths).toContain("src");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("README.md");

    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
    expect(paths.some((p) => p.startsWith("dist"))).toBe(false);
    expect(paths.some((p) => p.startsWith("vibeanalyzer-"))).toBe(false);
  });

  it("vyplní metadata (typ, přípona, velikost, hloubka)", async () => {
    const { files } = await scanTree(root);
    const idx = files.find((f) => f.path === "src/index.ts");
    expect(idx).toBeDefined();
    expect(idx?.type).toBe("file");
    expect(idx?.ext).toBe(".ts");
    expect(idx?.depth).toBe(2);
    expect((idx?.size ?? 0)).toBeGreaterThan(0);

    const srcDir = files.find((f) => f.path === "src");
    expect(srcDir?.type).toBe("dir");
    expect(srcDir?.depth).toBe(1);
  });

  it("nesleduje symlinky (žádné zacyklení)", async () => {
    // symlink mířící na sebe/rodiče by při sledování zacyklil
    await symlink(root, path.join(root, "loop")).catch(() => {});
    const { files } = await scanTree(root);
    expect(files.some((f) => f.path === "loop")).toBe(false);
  });

  it("vyloučí zadaný výstupní adresář i s podstromem (excludePaths)", async () => {
    const outDir = path.join(root, "report");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "neco.txt"), "x\n", "utf8");

    // bez vyloučení by se výstupní adresář i jeho obsah započítal
    const before = await scanTree(root);
    expect(before.files.some((f) => f.path === "report")).toBe(true);

    const { files } = await scanTree(root, { excludePaths: new Set([outDir]) });
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p === "report" || p.startsWith("report/"))).toBe(false);
    // zbytek stromu zůstává nedotčený
    expect(paths).toContain("src/index.ts");
  });

  it("vyloučí outDir zadaný přes symlink (kanonizace přes realpath)", async () => {
    const outDir = path.join(root, "report");
    await mkdir(outDir, { recursive: true });

    // symlink na root MIMO strom; outDir zadáme jeho symlinkovým zápisem cesty
    const linkBase = await mkdtemp(path.join(tmpdir(), "vibe-link-"));
    const linkToRoot = path.join(linkBase, "rootlink");
    await symlink(root, linkToRoot);
    const outViaSymlink = path.join(linkToRoot, "report"); // jiný string, stejná fyzická cesta

    const { files } = await scanTree(root, { excludePaths: new Set([outViaSymlink]) });
    await rm(linkBase, { recursive: true, force: true }).catch(() => {});

    // holé porovnání řetězců by tady selhalo (linkToRoot/report != root/report)
    expect(files.some((f) => f.path === "report")).toBe(false);
    expect(files.some((f) => f.path === "src/index.ts")).toBe(true);
  });

  it("DT_UNKNOWN: skutečný soubor dořeší přes lstat a ZAINDEXUJE (jádro 1-2)", async () => {
    const mroot = await mkdtemp(path.join(tmpdir(), "vibe-unknown-"));
    await real.writeFile(path.join(mroot, "mystery.ts"), "export const y = 2;\n", "utf8");
    // readdir vrátí Dirent bez typu (DT_UNKNOWN); soubor reálně existuje na disku
    vi.spyOn(fsp, "readdir").mockResolvedValue([unknownDirent("mystery.ts")] as never);

    const { files, skippedUnreadable } = await scanTree(mroot);
    await rm(mroot, { recursive: true, force: true }).catch(() => {});

    const f = files.find((e) => e.path === "mystery.ts");
    expect(f?.type).toBe("file");
    expect(f?.ext).toBe(".ts");
    expect(f?.size ?? 0).toBeGreaterThan(0);
    expect(skippedUnreadable).not.toContain("mystery.ts");
  });

  it("DT_UNKNOWN: adresář se dořeší přes lstat a REKURZIVNĚ projde (jádro 1-2 na FS bez d_type)", async () => {
    // reálná struktura na disku; readdr ji vrátí jako typeless (DT_UNKNOWN),
    // takže VŠECHNO projde lstat fallbackem – včetně adresáře a rekurze do něj.
    const mroot = await mkdtemp(path.join(tmpdir(), "vibe-unkdir-"));
    await real.mkdir(path.join(mroot, "sub"), { recursive: true });
    await real.writeFile(path.join(mroot, "sub", "inner.ts"), "export const z = 3;\n", "utf8");

    // path-aware mock: deleguje na reálný readdir (konečná struktura → žádné
    // zacyklení) a jen strhne typ z každého Direntu.
    vi.spyOn(fsp, "readdir").mockImplementation(async (dir, opts) => {
      const ents = await real.readdir(dir as string, opts as { withFileTypes: true });
      return ents.map((e) => unknownDirent(e.name)) as never;
    });

    const { files, skippedUnreadable } = await scanTree(mroot);
    await rm(mroot, { recursive: true, force: true }).catch(() => {});

    const sub = files.find((f) => f.path === "sub");
    const inner = files.find((f) => f.path === "sub/inner.ts");
    expect(sub?.type).toBe("dir"); // adresář se nezahodil ani neoznačil za soubor
    expect(inner?.type).toBe("file"); // rekurze proběhla a soubor uvnitř se zaindexoval
    expect(inner?.depth).toBe(2);
    expect(skippedUnreadable).toEqual([]);
  });

  it("zvláštní typ přes lstat fallback → skippedUnreadable (portovatelně, bez mkfifo)", async () => {
    const mroot = await mkdtemp(path.join(tmpdir(), "vibe-special-"));
    vi.spyOn(fsp, "readdir").mockResolvedValue([unknownDirent("weird")] as never);
    vi.spyOn(fsp, "lstat").mockImplementation(async (p) => {
      if (String(p).endsWith("weird")) return specialStat();
      return real.lstat(p as Parameters<typeof real.lstat>[0]);
    });

    const { files, skippedUnreadable } = await scanTree(mroot);
    await rm(mroot, { recursive: true, force: true }).catch(() => {});

    expect(files.some((f) => f.path === "weird")).toBe(false);
    expect(skippedUnreadable).toContain("weird");
  });

  it("DT_UNKNOWN, který je symlink → continue (nesleduje, neindexuje, nezaznamená)", async () => {
    const mroot = await mkdtemp(path.join(tmpdir(), "vibe-unklink-"));
    vi.spyOn(fsp, "readdir").mockResolvedValue([unknownDirent("link")] as never);
    vi.spyOn(fsp, "lstat").mockImplementation(async (p) => {
      if (String(p).endsWith("link")) return symlinkStat();
      return real.lstat(p as Parameters<typeof real.lstat>[0]);
    });

    const { files, skippedUnreadable } = await scanTree(mroot);
    await rm(mroot, { recursive: true, force: true }).catch(() => {});

    // symlink se má tiše přeskočit – ne zaindexovat ANI zaznamenat jako nečitelný
    expect(files.some((f) => f.path === "link")).toBe(false);
    expect(skippedUnreadable).not.toContain("link");
  });

  it.skipIf(!hasMkfifo)(
    "neztratí zvláštní typ (fifo) – zaznamená do skippedUnreadable",
    async () => {
      const fifo = path.join(root, "pipe");
      execFileSync("mkfifo", [fifo]); // bez try/catch – selhání = padlý test, ne tichý skip
      const { files, skippedUnreadable } = await scanTree(root);
      expect(files.some((f) => f.path === "pipe")).toBe(false);
      expect(skippedUnreadable).toContain("pipe");
    },
  );

  it("nečitelnou složku přeskočí a zaznamená, nespadne", async () => {
    const locked = path.join(root, "locked");
    await mkdir(locked, { recursive: true });
    await writeFile(path.join(locked, "secret.txt"), "x\n", "utf8");
    await chmod(locked, 0o000);

    const { skippedUnreadable } = await scanTree(root);
    // úklid práv, ať jde tempdir smazat
    await chmod(locked, 0o755).catch(() => {});

    expect(skippedUnreadable).toContain("locked");
  });

  // Připnutí kontraktu pro guard v cli.ts (nález 3-8): když nejde přečíst sám
  // KOŘEN scanu, musí to skončit přesně v ROOT_UNREADABLE_MARKER (ne v rel cestě
  // jako u podadresáře výš). Bez tohoto testu by refaktor scan.ts tiše rozbil
  // rozlišení „cíl nepřečten" vs „prázdný projekt" v cli.ts. Neexistující cesta
  // modeluje zmizelý cíl (TOCTOU) a readdir(root) deterministicky hodí.
  it("nečitelný KOŘEN → skippedUnreadable obsahuje ROOT_UNREADABLE_MARKER, žádné soubory", async () => {
    const gone = path.join(root, "tady-uz-nic-neni");
    const { files, skippedUnreadable } = await scanTree(gone);

    expect(files).toEqual([]);
    expect(skippedUnreadable).toContain(ROOT_UNREADABLE_MARKER);
  });

  // --- .gitignore přes injektovaný loadDirIgnore ---
  // scanTree zná jen loader + matcher, ne knihovnu `ignore`; kontrakt matcher↔ignore
  // je ověřen v gitignore.test.ts. Tady testujeme chování scanTree se zásobníkem
  // matcherů – fake loader keyovaný na absolutní cestu složky (bez fs).

  // helper: loader, který vrátí daný matcher JEN pro jednu konkrétní složku
  // (kanonizovanou přes realpath, protože scanTree kořen kanonizuje), jinak absent.
  function loaderFor(
    absTargetDir: string,
    match: (relToBase: string, isDir: boolean) => { ignored: boolean; unignored: boolean },
  ): (absDir: string) => Promise<DirIgnoreResult> {
    return async (absDir: string): Promise<DirIgnoreResult> =>
      absDir === absTargetDir ? { kind: "loaded", match } : { kind: "absent" };
  }

  it("gitignore: ignorovaný adresář se NEprochází (prořezání podstromu)", async () => {
    await mkdir(path.join(root, "vendor", "deep"), { recursive: true });
    await writeFile(path.join(root, "vendor", "deep", "x.php"), "<?php\n", "utf8");

    const realRoot = await realpath(root);
    const loadDirIgnore = loaderFor(realRoot, (relToBase, isDir) =>
      relToBase === "vendor" && isDir
        ? { ignored: true, unignored: false }
        : { ignored: false, unignored: false },
    );
    const { files, ignoredByGitignore, skippedUnreadable } = await scanTree(root, { loadDirIgnore });
    const paths = files.map((f) => f.path);

    expect(paths).not.toContain("vendor");
    // klíčové: do ignorované složky se vůbec nevlezlo (žádný potomek v indexu)
    expect(paths.some((p) => p.startsWith("vendor/"))).toBe(false);
    expect(paths).toContain("src/index.ts"); // zbytek stromu nedotčen
    expect(ignoredByGitignore).toBeGreaterThanOrEqual(1);
    // ignorováno ZÁMĚRNĚ ≠ nečitelné
    expect(skippedUnreadable).not.toContain("vendor");
  });

  it("gitignore: ignorovaný soubor se vynechá (a nepočítá jako nečitelný)", async () => {
    await writeFile(path.join(root, "secret.env"), "KEY=1\n", "utf8");

    const realRoot = await realpath(root);
    const loadDirIgnore = loaderFor(realRoot, (relToBase) =>
      relToBase === "secret.env"
        ? { ignored: true, unignored: false }
        : { ignored: false, unignored: false },
    );
    const { files, ignoredByGitignore, skippedUnreadable } = await scanTree(root, { loadDirIgnore });

    expect(files.some((f) => f.path === "secret.env")).toBe(false);
    expect(files.some((f) => f.path === "README.md")).toBe(true);
    expect(ignoredByGitignore).toBe(1);
    expect(skippedUnreadable).not.toContain("secret.env");
  });

  it("gitignore: matcher NIKDY nedostane prázdnou relToBase (sám adresář se netestuje)", async () => {
    // Ekvivalent staré invariance "predikát se nevolá na kořeni": matcher se testuje
    // jen na DĚTECH, nikdy na základně, kde .gitignore leží.
    const seen: string[] = [];
    const loadDirIgnore = async (): Promise<DirIgnoreResult> => ({
      kind: "loaded",
      match: (relToBase: string) => {
        seen.push(relToBase);
        return { ignored: false, unignored: false };
      },
    });
    await scanTree(root, { loadDirIgnore });

    expect(seen.length).toBeGreaterThan(0); // matcher se reálně volal
    expect(seen).not.toContain(""); // ale nikdy na prázdné cestě (základně)
  });

  it("vnořené pravidlo přebíjí mělčí (re-include přes !) – zásobník matcherů", async () => {
    // root/.gitignore ignoruje *.log; root/sub/.gitignore má !keep.log. Hlubší
    // úroveň re-include vrátí keep.log zpět, ostatní *.log zůstanou ignorované.
    await mkdir(path.join(root, "sub"), { recursive: true });
    await writeFile(path.join(root, "a.log"), "x\n", "utf8");
    await writeFile(path.join(root, "sub", "b.log"), "x\n", "utf8");
    await writeFile(path.join(root, "sub", "keep.log"), "x\n", "utf8");

    const realRoot = await realpath(root);
    const subAbs = path.join(realRoot, "sub");
    const loadDirIgnore = async (absDir: string): Promise<DirIgnoreResult> => {
      if (absDir === realRoot) {
        return {
          kind: "loaded",
          match: (relToBase) =>
            relToBase.endsWith(".log")
              ? { ignored: true, unignored: false }
              : { ignored: false, unignored: false },
        };
      }
      if (absDir === subAbs) {
        return {
          kind: "loaded",
          match: (relToBase) =>
            relToBase === "keep.log"
              ? { ignored: false, unignored: true }
              : { ignored: false, unignored: false },
        };
      }
      return { kind: "absent" };
    };

    const { files } = await scanTree(root, { loadDirIgnore });
    const paths = files.map((f) => f.path);

    expect(paths).not.toContain("a.log"); // root *.log
    expect(paths).not.toContain("sub/b.log"); // root *.log platí i hlouběji
    expect(paths).toContain("sub/keep.log"); // re-include z hlubšího !keep.log
  });

  it("degradace: unreadable/invalid loader → warning, podstrom se PŘESTO projde", async () => {
    await mkdir(path.join(root, "sub"), { recursive: true });
    await writeFile(path.join(root, "sub", "inner.ts"), "export const q = 1;\n", "utf8");

    const realRoot = await realpath(root);
    const subAbs = path.join(realRoot, "sub");
    const loadDirIgnore = async (absDir: string): Promise<DirIgnoreResult> => {
      if (absDir === subAbs) {
        return { kind: "unreadable", path: path.join(subAbs, ".gitignore"), code: "EISDIR" };
      }
      return { kind: "absent" };
    };

    const { files, gitignoreWarnings } = await scanTree(root, { loadDirIgnore });
    const paths = files.map((f) => f.path);

    // degradace se posbírala
    expect(gitignoreWarnings).toHaveLength(1);
    expect(gitignoreWarnings[0]).toMatchObject({ reason: "unreadable", code: "EISDIR" });
    // ale podstrom se PŘESTO prošel (bez pravidel té složky)
    expect(paths).toContain("sub");
    expect(paths).toContain("sub/inner.ts");
  });

  it("bez loadDirIgnore: ignoredByGitignore === 0, žádné warnings, výstup beze změny", async () => {
    const { files, ignoredByGitignore, gitignoreWarnings } = await scanTree(root);
    expect(ignoredByGitignore).toBe(0);
    expect(gitignoreWarnings).toEqual([]);
    // sanity: běžný strom se zaindexoval jako dosud
    expect(files.some((f) => f.path === "src/index.ts")).toBe(true);
  });
});
