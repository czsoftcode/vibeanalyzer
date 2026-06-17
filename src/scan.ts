import { lstat, readdir, realpath, stat } from "node:fs/promises";
import * as path from "node:path";

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
  /** predikát z .gitignore: ignorovaný adresář se NEprochází (prořezání
   *  podstromu), ignorovaný soubor se vynechá. `relPath` má oddělovač "/",
   *  je relativní ke kořeni; kořen (relPath="") se sem nikdy neposílá. */
  isIgnored?: (relPath: string, isDir: boolean) => boolean;
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
  const isIgnored = options.isIgnored;

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
  let ignoredByGitignore = 0;

  async function walk(absDir: string, relDir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      skippedUnreadable.push(relDir === "" ? ROOT_UNREADABLE_MARKER : relDir);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const ent of entries) {
      const rel = relDir === "" ? ent.name : `${relDir}/${ent.name}`;
      const abs = path.join(absDir, ent.name);

      if (ent.isSymbolicLink()) continue; // symlinky nesledujeme

      // Zjisti skutečný typ. Na FS bez d_type vrací readdir DT_UNKNOWN –
      // pak je isDirectory()/isFile() false a typ se musí dořešit přes lstat
      // (lstat, ne stat, ať se ani tady nesleduje symlink).
      let kind: "dir" | "file";
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
        if (isIgnored?.(rel, true)) {
          ignoredByGitignore++;
          continue;
        }
        files.push({ path: rel, type: "dir", ext: "", size: 0, depth });
        await walk(abs, rel, depth + 1);
      } else {
        if (isOutputArtifact(ent.name)) continue;
        // .gitignore: ignorovaný soubor se vynechá. Kontrola PŘED stat – ušetří
        // zbytečný stat na ignorovaných souborech.
        if (isIgnored?.(rel, false)) {
          ignoredByGitignore++;
          continue;
        }
        let size = 0;
        try {
          const st = await stat(abs);
          size = st.size;
        } catch {
          skippedUnreadable.push(rel);
          continue;
        }
        files.push({
          path: rel,
          type: "file",
          ext: path.extname(ent.name).toLowerCase(),
          size,
          depth,
        });
      }
    }
  }

  await walk(realRoot, "", 1);
  return { files, skippedUnreadable, ignoredByGitignore };
}
