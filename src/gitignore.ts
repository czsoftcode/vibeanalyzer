import { readFile } from "node:fs/promises";
import * as path from "node:path";
import ignore from "ignore";

/**
 * Predikát "ignoruje Git tuhle cestu?". `relPath` je cesta relativní ke kořeni
 * scanu, oddělovač "/" (stejný tvar, jaký staví scanTree). `isDir` rozlišuje
 * adresář od souboru – knihovna `ignore` NEdělá fs.stat, typ jí musíme dodat my
 * (přes koncové "/"), jinak by vzor "vendor/" (jen adresář) na složku vendor
 * nezabral.
 */
export type GitignorePredicate = (relPath: string, isDir: boolean) => boolean;

/**
 * Výsledek pokusu o načtení kořenového `.gitignore`. Stavy rozlišujeme záměrně
 * (jako u loadIntent), ať volající pozná "soubor prostě není / je prázdný"
 * (běžný stav → ticho) od "nešel přečíst" (problém k nahlášení na stderr).
 * - `absent`     – soubor neexistuje (ENOENT) NEBO je prázdný/jen bílé znaky
 *                  (žádné efektivní pravidlo → scan se nemá jak změnit),
 * - `loaded`     – soubor má obsah; `isIgnored` je matcher nad reálnou `ignore`,
 * - `unreadable` – soubor existuje, ale čtení selhalo (práva, je to adresář, …),
 * - `invalid`    – soubor se přečetl, ale obsahuje vzor, který nejde zkompilovat
 *                  (matcher by házel). Scan poběží bez něj – degradace nahlas.
 */
export type GitignoreResult =
  | { kind: "loaded"; isIgnored: GitignorePredicate }
  | { kind: "absent" }
  | { kind: "unreadable"; path: string; code: string }
  | { kind: "invalid"; path: string };

/**
 * Strop na délku JEDINÉ řádky .gitignore. Reálné glob vzory mají desítky znaků;
 * řádka o tisících znacích je patologická (generovaná/poškozená). `ignore` z ní
 * staví jeden velký regex a V8 ho buď kompiluje celé VTEŘINY, nebo (nad ~35 000
 * znaky) zamítne jako "Invalid regular expression: too large" – a hodí LÍNĚ, až
 * při prvním `ignores()`. To by uvnitř scanTree (jinak plně defenzivní, na vstupu
 * nehází) shodilo celou analýzu místo slíbené degradace (nález 6-1). Takovou
 * řádku proto odmítneme JEŠTĚ PŘED kompilací: degradace je nahlas a hlavně
 * RYCHLÁ, ne mnohavteřinové zaseknutí. 4096 je hluboko pod pásmem, kde kompilace
 * regexu zpomaluje, a řádově nad jakýmkoli reálným vzorem.
 */
const MAX_GITIGNORE_LINE = 4096;

/**
 * Načte KOŘENOVÝ `<root>/.gitignore` a vrátí matcher pro scanTree. Čistě
 * READ-ONLY – soubor jen čte, nikdy nepíše (non-goal č. 1). Vnořené `.gitignore`
 * v podadresářích záměrně NEčte (mimo rozsah této fáze).
 */
export async function loadGitignore(root: string): Promise<GitignoreResult> {
  const file = path.join(root, ".gitignore");

  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { kind: "absent" }; // soubor není → ticho
    return { kind: "unreadable", path: file, code: e.code ?? "neznámá chyba" };
  }

  // Prázdný / jen bílé znaky → žádné efektivní pravidlo. Vracíme `absent`, ať je
  // výstup BIT-identický s během bez .gitignore (žádný matcher se nepředá).
  if (content.trim().length === 0) return { kind: "absent" };

  // Patologicky dlouhá řádka → invalid JEŠTĚ PŘED kompilací (viz
  // MAX_GITIGNORE_LINE). Tím se vyhneme jak mnohavteřinové kompilaci, tak línému
  // throwu z `ignores()`, který by jinak shodil scanTree.
  if (content.split(/\r?\n/).some((line) => line.length > MAX_GITIGNORE_LINE)) {
    return { kind: "invalid", path: file };
  }

  // allowRelativePaths: predikát se volá na cestách stavěných z reálných jmen
  // souborů. `ignore` jinak na některé tvary (např. cesta jako ".") HÁŽE; scanTree
  // ale musí zůstat plně defenzivní (nehází na vstupu), tak validaci uvolníme –
  // matching pro normální relativní cesty se tím nemění, jen se přestane házet.
  const ig = ignore({ allowRelativePaths: true }).add(content);

  const isIgnored: GitignorePredicate = (relPath, isDir) => {
    // Kořen (relPath === "") se sem nikdy nemá dostat (scanTree ho neposílá),
    // ale pojistka: prázdná cesta není platná a nedává smysl ji ignorovat.
    if (relPath === "") return false;
    // Adresář zkoušíme s koncovým "/" – tím zabere i vzor "vendor/" (dir-only)
    // a zároveň vzor bez lomítka ("vendor") matchuje obojí.
    const probe = isDir ? `${relPath}/` : relPath;
    return ig.ignores(probe);
  };

  return { kind: "loaded", isIgnored };
}
