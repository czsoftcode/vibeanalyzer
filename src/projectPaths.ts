import { createHash } from "node:crypto";
import * as path from "node:path";

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
