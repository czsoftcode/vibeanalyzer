import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type GitignoreResult, loadGitignore } from "./gitignore.js";

// Testy běží proti REÁLNÉ knihovně `ignore`, ne proti mocku – právě tady se
// ověřuje kontrakt mezi naším predikátem (koncové "/" pro adresář) a chováním
// knihovny. Mock by tenhle kontrakt jen zkopíroval, ne ověřil.

function loadedOrThrow(r: GitignoreResult): (relPath: string, isDir: boolean) => boolean {
  if (r.kind !== "loaded") throw new Error(`čekal jsem loaded, dostal ${r.kind}`);
  return r.isIgnored;
}

describe("loadGitignore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vibe-gi-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("chybějící .gitignore → absent (scan se nemá jak změnit)", async () => {
    const r = await loadGitignore(root);
    expect(r.kind).toBe("absent");
  });

  it("prázdný .gitignore → absent", async () => {
    await writeFile(path.join(root, ".gitignore"), "", "utf8");
    const r = await loadGitignore(root);
    expect(r.kind).toBe("absent");
  });

  it("jen bílé znaky a komentáře bez pravidla → absent", async () => {
    await writeFile(path.join(root, ".gitignore"), "   \n\n\t\n", "utf8");
    const r = await loadGitignore(root);
    expect(r.kind).toBe("absent");
  });

  it("nečitelný .gitignore (je to adresář) → unreadable s kódem", async () => {
    // .gitignore jako ADRESÁŘ → readFile hodí EISDIR; modeluje "existuje, ale
    // nejde přečíst" bez závislosti na chmod (které pod rootem neplatí).
    await mkdir(path.join(root, ".gitignore"), { recursive: true });
    const r = await loadGitignore(root);
    expect(r.kind).toBe("unreadable");
    if (r.kind === "unreadable") {
      expect(r.code).toBe("EISDIR");
      expect(r.path).toBe(path.join(root, ".gitignore"));
    }
  });

  it("vzor 'vendor/' ignoruje SLOŽKU vendor i obsah, ne SOUBOR jménem vendor", async () => {
    await writeFile(path.join(root, ".gitignore"), "vendor/\nvar/cache/\n", "utf8");
    const isIgnored = loadedOrThrow(await loadGitignore(root));

    // adresář vendor (dir-only vzor zabere jen s koncovým "/")
    expect(isIgnored("vendor", true)).toBe(true);
    // soubor jménem "vendor" se dir-only vzorem ignorovat NEMÁ
    expect(isIgnored("vendor", false)).toBe(false);
    // obsah pod ignorovanou složkou
    expect(isIgnored("vendor/autoload.php", false)).toBe(true);
    // vnořená cesta var/cache
    expect(isIgnored("var/cache", true)).toBe(true);
    expect(isIgnored("var/cache/app.php", false)).toBe(true);
    // var sám není ignorovaný (musí se do něj dát vejít kvůli var/cache)
    expect(isIgnored("var", true)).toBe(false);
    // nesouvisející soubor projde
    expect(isIgnored("src/index.ts", false)).toBe(false);
  });

  it("negace '!' se respektuje (kontrakt s knihovnou)", async () => {
    await writeFile(path.join(root, ".gitignore"), "*.log\n!keep.log\n", "utf8");
    const isIgnored = loadedOrThrow(await loadGitignore(root));

    expect(isIgnored("debug.log", false)).toBe(true);
    expect(isIgnored("keep.log", false)).toBe(false);
  });

  it("kořen (prázdná cesta) se nikdy neoznačí za ignorovaný", async () => {
    await writeFile(path.join(root, ".gitignore"), "*\n", "utf8");
    const isIgnored = loadedOrThrow(await loadGitignore(root));
    // vzor '*' ignoruje vše, ale kořen scanu do matcheru nepatří
    expect(isIgnored("", true)).toBe(false);
    expect(isIgnored("", false)).toBe(false);
  });

  it("vzor '*' (smaž vše) ignoruje libovolnou cestu pod kořenem", async () => {
    await writeFile(path.join(root, ".gitignore"), "*\n", "utf8");
    const isIgnored = loadedOrThrow(await loadGitignore(root));
    expect(isIgnored("src", true)).toBe(true);
    expect(isIgnored("README.md", false)).toBe(true);
  });

  it("patologicky dlouhá řádka → invalid (strop před kompilací, nález 6-1)", async () => {
    // Řádka delší než MAX_GITIGNORE_LINE (4096). `ignore` by z ní stavěl obří
    // regex, který V8 kompiluje vteřiny nebo zamítne jako 'too large' (hodí líně
    // až v ignores()) → uvnitř scanTree by to shodilo celou analýzu. loadGitignore
    // takovou řádku musí odmítnout JEŠTĚ PŘED kompilací a vrátit 'invalid'.
    await writeFile(path.join(root, ".gitignore"), `${"a".repeat(40000)}\n`, "utf8");
    const r = await loadGitignore(root);
    expect(r.kind).toBe("invalid");
    if (r.kind === "invalid") {
      expect(r.path).toBe(path.join(root, ".gitignore"));
    }
  });

  it("dlouhá řádka v rámci stropu (4096) projde normálně", async () => {
    // hranice: přesně na stropu se ještě kompiluje a vrací matcher (loaded)
    await writeFile(path.join(root, ".gitignore"), `vendor/\n${"b".repeat(4096)}\n`, "utf8");
    const r = await loadGitignore(root);
    expect(r.kind).toBe("loaded");
  });
});
