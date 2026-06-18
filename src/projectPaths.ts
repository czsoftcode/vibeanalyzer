import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

/** Název souboru se záměrem – literál sdílený čtením i zápisem domácího úložiště. */
const INTENT_FILENAME = "project.md";

/**
 * Stabilní klíč adresáře projektu pod `~/.vibeanalyzer/`. JEDEN klíč = jedna
 * složka projektu (report i záměr leží spolu), ať se uživateli vše k jednomu
 * projektu drží na jednom místě.
 *
 * Tvar `basename-<8 hex>`, kde hash je SHA-1 ABSOLUTNÍ (normalizované) cesty.
 * - `path.resolve` srovná `./app` i `/abs/app` na stejný klíč (idempotence),
 * - hash zabrání KOLIZI: dva různé adresáře se stejným basename (`/a/app`,
 *   `/b/app`) dostanou různý klíč → report ani záměr se nepřepíšou / nepletou
 *   (jinak tichý falešný výsledek – čtení cizího záměru, přepis cizího reportu),
 * - basename v prefixu drží klíč čitelný pro člověka (najde/upraví složku),
 * - prázdný basename (kořen `/`) → `root` (čitelný fallback, ne holá pomlčka).
 *
 * Sdílí ho `args.defaultOutDir` (kam zapsat report) i `intent.loadIntent` (odkud
 * číst záměr) – proto je tady, ne v jednom z nich. Když se schéma změní, mění se
 * na JEDNOM místě a oba zůstanou v souladu.
 */
export function projectKey(targetPath: string): string {
  const abs = path.resolve(targetPath);
  const hash = createHash("sha1").update(abs).digest("hex").slice(0, 8);
  const base = path.basename(abs) || "root";
  return `${base}-${hash}`;
}

/**
 * Domovský adresář, defenzivně: prázdný řetězec i výjimka z `os.homedir()` →
 * undefined ("domov neznámý"). Sdílí ho čtení záměru (`intent.loadIntent`) i jeho
 * zápis (`intentWriter.writeIntentFile`), ať se obě vrstvy shodnou na tom, CO je
 * domov – jinak by jedna psala tam, odkud druhá nečte.
 */
export function safeHomedir(): string | undefined {
  try {
    const home = os.homedir();
    return home && home.length > 0 ? home : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Absolutní cesta k domácímu úložišti záměru: `<home>/.vibeanalyzer/<projectKey>/project.md`.
 * Vrátí null, když domov není znám (prázdný/nedostupný) – pak ho z hledání/zápisu
 * jen vynecháme, ať absence domova nezhatí zbytek.
 *
 * Tohle je KONTRAKTNÍ cesta sdílená mezi čtením (`loadIntent`) a zápisem
 * (`writeIntentFile`): writer musí zapsat PŘESNĚ tam, odkud loadIntent čte. Proto
 * je definovaná na jednom místě – kdyby se schéma změnilo, mění se tu a obě
 * vrstvy zůstanou v souladu (round-trip test to hlídá).
 */
export function homeIntentPath(homeDir: string | undefined, targetPath: string): string | null {
  if (!homeDir) return null;
  return path.join(homeDir, ".vibeanalyzer", projectKey(targetPath), INTENT_FILENAME);
}
