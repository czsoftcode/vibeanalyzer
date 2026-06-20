import type { Dirent } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import type { DirIgnoreMatcher, DirIgnoreResult } from "./gitignore.js";
import { isMinifiedName } from "./minified.js";

/** Jeden záznam ve strukturálním indexu. */
export interface FileEntry {
  /** cesta relativní ke kořeni, oddělovač vždy "/" */
  path: string;
  type: "file" | "dir";
  /** přípona souboru malými písmeny včetně tečky (".ts"); pro složky "" */
  ext: string;
  /** velikost v bajtech; pro složky 0 */
  size: number;
  /** hloubka od kořene; přímé děti kořene = 1 */
  depth: number;
  /** `true`, když jméno souboru vypadá jako minifikát (`*.min.<ext>`); složky vždy
   *  `false`. Spočítáno zde přes `isMinifiedName`. Report-level konzumenti (počty,
   *  seznam, graf modulů, JSON) ČTOU tento příznak. Jediný zdroj pravdy o ROZHODNUTÍ
   *  je sdílená funkce `isMinifiedName` – eslint/secrets si ji volají samostatně na
   *  basename (ne přes tento příznak), ale na týž regex, takže se nemůžou rozejít. */
  minified: boolean;
}

/** Vnořený/kořenový `.gitignore`, který existuje, ale nešel použít – degradace
 *  k nahlášení (jako u kořene ve fázi 6, teď i pro podsložky). scanTree netiskne;
 *  posbírá a předá volajícímu (cli), ať zůstane testovatelný. */
export interface GitignoreWarning {
  /** absolutní cesta k problémovému `.gitignore` */
  path: string;
  /** `unreadable` – existuje, ale čtení selhalo; `invalid` – nejde zkompilovat */
  reason: "unreadable" | "invalid";
  /** errno kód u `unreadable` (např. EISDIR); u `invalid` nedefinováno */
  code?: string;
}

/** Výsledek průchodu stromem. */
export interface ScanResult {
  files: FileEntry[];
  /** relativní cesty, které nešlo přečíst (přeskočeno, ne pád) */
  skippedUnreadable: string[];
  /** počet vynechaných položek NEJVYŠŠÍ úrovně kvůli .gitignore: prořezaný
   *  adresář se počítá jako 1 BEZ ohledu na obsah (do podstromu se nevstupuje –
   *  vendor/ s 10000 soubory přidá 1, ne 10001), ignorovaný soubor jako 1.
   *  NENÍ to součet souborů uvnitř. Slouží jen k rozlišení "prázdná složka" od
   *  "vše odfiltroval .gitignore" (čteno jako boolean > 0). */
  ignoredByGitignore: number;
  /** vnořené/kořenové .gitignore, které existují, ale nešly použít (degradace) */
  gitignoreWarnings: GitignoreWarning[];
}

/** Pomocné/nástrojové složky, které do indexu nepatří. */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".mini",
  "dist",
  "build",
]);

/** Vlastní výstupní soubory nástroje – ať se příští běh nezapočítá do sebe. */
const OUTPUT_ARTIFACT_RE = /^vibeanalyzer-.*\.(json|md)$/i;

/**
 * Značka v `skippedUnreadable` pro případ, že nešel přečíst sám KOŘEN scanu
 * (readdir(root) hodil). Relativní cesta kořene je "" → značíme "." (relDir je
 * jinak vždy konkrétní jméno, takže "." nemůže kolidovat s reálným záznamem).
 * Sdílená konstanta záměrně: `cli.ts` na ni váže rozlišení „cíl nepřečten" vs
 * „prázdný projekt" – holý literál na dvou místech by se při refaktoru rozešel.
 */
export const ROOT_UNREADABLE_MARKER = ".";

export interface ScanOptions {
  skipDirs?: ReadonlySet<string>;
  isOutputArtifact?: (name: string) => boolean;
  /** absolutní cesty, které se mají vynechat i s celým podstromem
   *  (typicky vlastní výstupní adresář ležící uvnitř scanovaného stromu) */
  excludePaths?: ReadonlySet<string>;
  /** Loader `.gitignore` pro jednu složku, volaný AŽ ZA běhu na každé vstoupené
   *  složce (kořen i podsložky). Injekce ho drží mimo scanTree → scanTree zůstává
   *  testovatelný bez fs (fake keyovaný na absDir). `loaded` matcher se přidá na
   *  zásobník (jeden na složku), `unreadable`/`invalid` jde do gitignoreWarnings,
   *  `absent` = nic. Na PROŘEZANÉ (ignorované) ani přeskakované složky se nevolá –
   *  do nich se nevstupuje. */
  loadDirIgnore?: (absDir: string) => Promise<DirIgnoreResult>;
}

/** Jeden rámec zásobníku matcherů: matcher složky + její cesta relativní ke
 *  kořeni scanu (báze, vůči které matcher testuje). */
interface IgnoreFrame {
  baseRel: string;
  match: DirIgnoreMatcher;
}

/**
 * Projde strom složky `root` do plochého seznamu záznamů.
 * - přeskakuje pomocné složky (DEFAULT_SKIP_DIRS),
 * - NEsleduje symlinky (obrana proti zacyklení),
 * - nečitelnou složku/soubor přeskočí a zaznamená do `skippedUnreadable`.
 */
export async function scanTree(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const isOutputArtifact = options.isOutputArtifact ?? ((n: string) => OUTPUT_ARTIFACT_RE.test(n));
  const loadDirIgnore = options.loadDirIgnore;

  // Vyloučení outDir nemůže být holé porovnání řetězců: path.resolve normalizuje
  // ".."/"." ale NErozbaluje symlinky. Pokud se ke stejnému fyzickému adresáři
  // dá dojít dvěma zápisy cesty (např. --out přes symlink), string match selže a
  // výstupní adresář by se zaindexoval (a rostl s každým během). Proto kanonizace
  // přes realpath na obou koncích: kořen i vylučované cesty. walk pak staví abs
  // od kanonického kořene a symlinky nesleduje, takže porovnání sedí.
  const realRoot = await realpath(root).catch(() => root);
  const excludePaths = new Set<string>();
  for (const p of options.excludePaths ?? []) {
    excludePaths.add(await realpath(p).catch(() => p));
  }

  const files: FileEntry[] = [];
  const skippedUnreadable: string[] = [];
  const gitignoreWarnings: GitignoreWarning[] = [];
  let ignoredByGitignore = 0;

  // Zásobník matcherů, jeden na vstoupenou složku (mělký → hluboký). Prázdný =
  // žádný loader / žádné pravidlo → ignoredByStack vrací false a chování je
  // bit-identické s během bez .gitignore.
  const stack: IgnoreFrame[] = [];

  /**
   * Verdikt zásobníku o jedné cestě: projdi rámce MĚLKÝ → HLUBOKÝ, každý testuj
   * proti cestě relativní k JEHO bázi. Vyhrává POSLEDNÍ rozhodný názor – hlubší
   * `!` (unignored) přebije mělčí ignore, hlubší ignore přebije mělčí. Rámec bez
   * názoru (obě false) verdikt nemění. Tím se replikuje Git: hlubší .gitignore má
   * přednost, re-include funguje napříč úrovněmi.
   */
  function ignoredByStack(rel: string, isDir: boolean): boolean {
    let verdict = false;
    for (const frame of stack) {
      // rel vždy leží POD bází rámce (rámec je předek aktuální složky), takže
      // strhnutí prefixu "baseRel/" dá cestu relativní k bázi. Kořenový rámec má
      // baseRel="" → testuje se celá rel.
      const relToBase = frame.baseRel === "" ? rel : rel.slice(frame.baseRel.length + 1);
      const v = frame.match(relToBase, isDir);
      if (v.unignored) verdict = false;
      else if (v.ignored) verdict = true;
    }
    return verdict;
  }

  async function walk(absDir: string, relDir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      skippedUnreadable.push(relDir === "" ? ROOT_UNREADABLE_MARKER : relDir);
      return;
    }

    // .gitignore TÉTO složky načítáme AŽ když víme, že složku jde číst (jinak
    // nemá co filtrovat a readFile by jen házel podruhé). Děláme to PŘED zpracováním
    // dětí, protože pravidla té složky platí na její děti i hlouběji. `loaded` →
    // rámec na zásobník (pop v finally), degradaci sbíráme, `absent` = ticho.
    let pushed = false;
    if (loadDirIgnore) {
      const res = await loadDirIgnore(absDir);
      if (res.kind === "loaded") {
        stack.push({ baseRel: relDir, match: res.match });
        pushed = true;
      } else if (res.kind === "unreadable") {
        gitignoreWarnings.push({ path: res.path, reason: "unreadable", code: res.code });
      } else if (res.kind === "invalid") {
        gitignoreWarnings.push({ path: res.path, reason: "invalid" });
      }
    }

    try {
      await walkEntries(absDir, relDir, depth, entries);
    } finally {
      if (pushed) stack.pop();
    }
  }

  async function walkEntries(
    absDir: string,
    relDir: string,
    depth: number,
    entries: Dirent[],
  ): Promise<void> {
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const ent of entries) {
      const rel = relDir === "" ? ent.name : `${relDir}/${ent.name}`;
      const abs = path.join(absDir, ent.name);

      if (ent.isSymbolicLink()) continue; // symlinky nesledujeme

      // Zjisti skutečný typ. Na FS bez d_type vrací readdir DT_UNKNOWN –
      // pak je isDirectory()/isFile() false a typ se musí dořešit přes lstat
      // (lstat, ne stat, ať se ani tady nesleduje symlink).
      let kind: "dir" | "file";
      // Velikost už známá z lstatu (jen u DT_UNKNOWN souborů). lstat na regulérní
      // nesymlink soubor vrací stejné st.size jako stat → druhý stat níž je zbytečný
      // syscall. Když zůstane undefined (běžná cesta s d_type), velikost dořeší stat.
      let knownSize: number | undefined;
      if (ent.isDirectory()) {
        kind = "dir";
      } else if (ent.isFile()) {
        kind = "file";
      } else {
        let st;
        try {
          st = await lstat(abs);
        } catch {
          skippedUnreadable.push(rel);
          continue;
        }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          kind = "dir";
        } else if (st.isFile()) {
          kind = "file";
          knownSize = st.size;
        } else {
          // fifo, socket, blokové/znakové zařízení – do indexu nepatří,
          // ale nesmí zmizet beze stopy (jinak tiché zahození).
          skippedUnreadable.push(rel);
          continue;
        }
      }

      if (kind === "dir") {
        if (skipDirs.has(ent.name)) continue;
        if (excludePaths.has(abs)) continue; // vlastní výstupní adresář uvnitř stromu
        // .gitignore: ignorovaný adresář se NEprochází (prořezání podstromu).
        // Vůči Gitu korektní: ignorovaná rodičovská složka nejde znovu zahrnout
        // zevnitř, takže do ní nemusíme vlézt – a hlavně se tím vyhneme průchodu
        // desetitisíci souborů ve vendor/ apod.
        if (ignoredByStack(rel, true)) {
          ignoredByGitignore++;
          continue;
        }
        files.push({ path: rel, type: "dir", ext: "", size: 0, depth, minified: false });
        await walk(abs, rel, depth + 1);
      } else {
        if (isOutputArtifact(ent.name)) continue;
        // .gitignore: ignorovaný soubor se vynechá. Kontrola PŘED stat – ušetří
        // zbytečný stat na ignorovaných souborech.
        if (ignoredByStack(rel, false)) {
          ignoredByGitignore++;
          continue;
        }
        let size: number;
        if (knownSize !== undefined) {
          // velikost už máme z lstatu (DT_UNKNOWN cesta) → žádný druhý stat
          size = knownSize;
        } else {
          try {
            const st = await stat(abs);
            size = st.size;
          } catch {
            skippedUnreadable.push(rel);
            continue;
          }
        }
        files.push({
          path: rel,
          type: "file",
          ext: path.extname(ent.name).toLowerCase(),
          size,
          depth,
          minified: isMinifiedName(ent.name),
        });
      }
    }
  }

  await walk(realRoot, "", 1);
  return { files, skippedUnreadable, ignoredByGitignore, gitignoreWarnings };
}
