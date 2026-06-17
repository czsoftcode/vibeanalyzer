import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DirIgnoreMatcher, type DirIgnoreResult, loadDirIgnore } from "./gitignore.js";

// Testy běží proti REÁLNÉ knihovně `ignore`, ne proti mocku – právě tady se
// ověřuje kontrakt mezi naším matcherem (koncové "/" pro adresář, rozlišení
// ignored/unignored) a chováním knihovny. Mock by tenhle kontrakt jen zkopíroval,
// ne ověřil.

function loadedMatch(r: DirIgnoreResult): DirIgnoreMatcher {
  if (r.kind !== "loaded") throw new Error(`čekal jsem loaded, dostal ${r.kind}`);
  return r.match;
}

describe("loadDirIgnore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vibe-gi-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("chybějící .gitignore → absent (scan se nemá jak změnit)", async () => {
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("absent");
  });

  it("prázdný .gitignore → absent", async () => {
    await writeFile(path.join(dir, ".gitignore"), "", "utf8");
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("absent");
  });

  it("jen bílé znaky a komentáře bez pravidla → absent", async () => {
    await writeFile(path.join(dir, ".gitignore"), "   \n\n\t\n", "utf8");
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("absent");
  });

  it("nečitelný .gitignore (je to adresář) → unreadable s kódem", async () => {
    // .gitignore jako ADRESÁŘ → readFile hodí EISDIR; modeluje "existuje, ale
    // nejde přečíst" bez závislosti na chmod (které pod rootem neplatí).
    await mkdir(path.join(dir, ".gitignore"), { recursive: true });
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("unreadable");
    if (r.kind === "unreadable") {
      expect(r.code).toBe("EISDIR");
      expect(r.path).toBe(path.join(dir, ".gitignore"));
    }
  });

  it("vzor 'vendor/' ignoruje SLOŽKU vendor i obsah, ne SOUBOR jménem vendor", async () => {
    await writeFile(path.join(dir, ".gitignore"), "vendor/\nvar/cache/\n", "utf8");
    const m = loadedMatch(await loadDirIgnore(dir));

    // adresář vendor (dir-only vzor zabere jen s koncovým "/")
    expect(m("vendor", true).ignored).toBe(true);
    // soubor jménem "vendor" se dir-only vzorem ignorovat NEMÁ
    expect(m("vendor", false).ignored).toBe(false);
    // obsah pod ignorovanou složkou
    expect(m("vendor/autoload.php", false).ignored).toBe(true);
    // vnořená cesta var/cache
    expect(m("var/cache", true).ignored).toBe(true);
    expect(m("var/cache/app.php", false).ignored).toBe(true);
    // var sám není ignorovaný (musí se do něj dát vejít kvůli var/cache)
    expect(m("var", true).ignored).toBe(false);
    // nesouvisející soubor projde
    expect(m("src/index.ts", false).ignored).toBe(false);
  });

  it("negace '!' v jednom souboru: ignored u *.log, unignored u !keep.log", async () => {
    await writeFile(path.join(dir, ".gitignore"), "*.log\n!keep.log\n", "utf8");
    const m = loadedMatch(await loadDirIgnore(dir));

    expect(m("debug.log", false).ignored).toBe(true);
    const keep = m("keep.log", false);
    expect(keep.ignored).toBe(false);
    expect(keep.unignored).toBe(true);
  });

  it("SAMOSTATNÉ '!keep.log' hlásí unignored:true (kontrakt pro skládání matcherů)", async () => {
    // Jádro celé fáze: vnořený .gitignore obsahuje JEN negaci, pozitivní vzor
    // (*.log) je v MĚLČÍM souboru. scanTree skládá matchery přes sebe a re-include
    // pozná právě podle unignored. Kdyby `ignore` u osamělé negace vracelo
    // unignored:false, src/sub/keep.log by se nikdy nevrátilo. Tenhle test ten
    // předpoklad připíná na reálnou knihovnu.
    await writeFile(path.join(dir, ".gitignore"), "!keep.log\n", "utf8");
    const m = loadedMatch(await loadDirIgnore(dir));

    const keep = m("keep.log", false);
    expect(keep.unignored).toBe(true);
    expect(keep.ignored).toBe(false);

    // nesouvisející soubor: matcher nemá názor (obě false → mělčí verdikt platí dál)
    const other = m("other.log", false);
    expect(other.ignored).toBe(false);
    expect(other.unignored).toBe(false);
  });

  it("prázdná relToBase (sám adresář matcheru) se nikdy neoznačí", async () => {
    await writeFile(path.join(dir, ".gitignore"), "*\n", "utf8");
    const m = loadedMatch(await loadDirIgnore(dir));
    // vzor '*' ignoruje vše, ale základna matcheru (relToBase="") do něj nepatří
    expect(m("", true)).toEqual({ ignored: false, unignored: false });
    expect(m("", false)).toEqual({ ignored: false, unignored: false });
  });

  it("vzor '*' (smaž vše) ignoruje libovolnou cestu pod složkou", async () => {
    await writeFile(path.join(dir, ".gitignore"), "*\n", "utf8");
    const m = loadedMatch(await loadDirIgnore(dir));
    expect(m("src", true).ignored).toBe(true);
    expect(m("README.md", false).ignored).toBe(true);
  });

  it("patologicky dlouhá řádka → invalid (strop před kompilací, nález 6-1)", async () => {
    // Řádka delší než MAX_GITIGNORE_LINE (4096). `ignore` by z ní stavěl obří
    // regex, který V8 kompiluje vteřiny nebo zamítne jako 'too large' (hodí líně
    // až v test()) → uvnitř scanTree by to shodilo celou analýzu. loadDirIgnore
    // takovou řádku musí odmítnout JEŠTĚ PŘED kompilací a vrátit 'invalid'.
    await writeFile(path.join(dir, ".gitignore"), `${"a".repeat(40000)}\n`, "utf8");
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("invalid");
    if (r.kind === "invalid") {
      expect(r.path).toBe(path.join(dir, ".gitignore"));
    }
  });

  it("patologicky velký soubor (hodně krátkých řádek) → invalid (strop na velikost)", async () => {
    // Druhá podoba patologie: každá řádka je krátká (pod MAX_GITIGNORE_LINE), ale
    // dohromady je souboru přes MAX_GITIGNORE_BYTES. `ignore` z každé staví regex
    // a kompilace/test by trvaly vteřiny – a to per-složku. Musí degradovat PŘED
    // kompilací, ne zaseknout scanTree.
    const huge = `${"node_modules/x\n".repeat(20000)}`; // ~280 KiB krátkých řádek
    await writeFile(path.join(dir, ".gitignore"), huge, "utf8");
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("invalid");
  });

  it("soubor pod stropem velikosti (mnoho krátkých řádek) projde normálně", async () => {
    // hranice z druhé strany: stovky krátkých řádek (reálné velké .gitignore) se
    // nesmí splést s patologií – pořád loaded.
    const realistic = `${"build/\n".repeat(500)}`; // ~3,5 KiB
    await writeFile(path.join(dir, ".gitignore"), realistic, "utf8");
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("loaded");
  });

  it("dlouhá řádka v rámci stropu (4096) projde normálně", async () => {
    // hranice: přesně na stropu se ještě kompiluje a vrací matcher (loaded)
    await writeFile(path.join(dir, ".gitignore"), `vendor/\n${"b".repeat(4096)}\n`, "utf8");
    const r = await loadDirIgnore(dir);
    expect(r.kind).toBe("loaded");
  });
});
