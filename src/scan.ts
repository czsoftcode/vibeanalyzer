import { readdir, stat } from "node:fs/promises";
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

export interface ScanOptions {
  skipDirs?: ReadonlySet<string>;
  isOutputArtifact?: (name: string) => boolean;
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

  const files: FileEntry[] = [];
  const skippedUnreadable: string[] = [];

  async function walk(absDir: string, relDir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      skippedUnreadable.push(relDir === "" ? "." : relDir);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const ent of entries) {
      const rel = relDir === "" ? ent.name : `${relDir}/${ent.name}`;
      const abs = path.join(absDir, ent.name);

      if (ent.isSymbolicLink()) continue; // symlinky nesledujeme

      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name)) continue;
        files.push({ path: rel, type: "dir", ext: "", size: 0, depth });
        await walk(abs, rel, depth + 1);
      } else if (ent.isFile()) {
        if (isOutputArtifact(ent.name)) continue;
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
      // ostatní typy (socket, fifo, blokové zařízení) ignorujeme
    }
  }

  await walk(root, "", 1);
  return { files, skippedUnreadable };
}
