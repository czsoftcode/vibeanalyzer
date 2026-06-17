import { readFile } from "node:fs/promises";
import * as path from "node:path";
import ignore from "ignore";

/**
 * Verdikt JEDNOHO `.gitignore` matcheru o jedné cestě.
 * - `ignored`   – nějaký POZITIVNÍ vzor cestu zabral,
 * - `unignored` – nějaký NEGATIVNÍ vzor (`!`) cestu výslovně vrátil zpět.
 *
 * Obě `false` = matcher nemá názor. Rozlišení je nutné pro SKLÁDÁNÍ matcherů přes
 * sebe (zásobník ve scanTree): hlubší úroveň smí mělčí verdikt přebít jen když má
 * rozhodný názor (`ignored` nebo `unignored`), ne když mlčí. Booleovský predikát
 * (jen "ignoruje?") by re-include přes `!` napříč úrovněmi neuměl rozlišit od
 * "nemám pravidlo".
 */
export interface IgnoreVerdict {
  ignored: boolean;
  unignored: boolean;
}

/**
 * Matcher pro JEDNU složku, kde `.gitignore` leží. `relToBase` je cesta relativní
 * K TÉ složce (oddělovač "/", stejný tvar, jaký staví scanTree). `isDir` rozlišuje
 * adresář od souboru – knihovna `ignore` NEdělá fs.stat, typ jí musíme dodat my
 * (přes koncové "/"), jinak by vzor "vendor/" (jen adresář) na složku vendor
 * nezabral.
 */
export type DirIgnoreMatcher = (relToBase: string, isDir: boolean) => IgnoreVerdict;

/**
 * Výsledek pokusu o načtení `.gitignore` v jedné složce. Stavy rozlišujeme záměrně
 * (jako u loadIntent), ať volající (scanTree) pozná "soubor prostě není / je
 * prázdný" (běžný stav → ticho) od "nešel přečíst / nejde zpracovat" (degradace
 * k nahlášení na stderr).
 * - `absent`     – soubor neexistuje (ENOENT) NEBO je prázdný/jen bílé znaky
 *                  (žádné efektivní pravidlo → scan se nemá jak změnit),
 * - `loaded`     – soubor má obsah; `match` je nad reálnou `ignore`,
 * - `unreadable` – soubor existuje, ale čtení selhalo (práva, je to adresář, …),
 * - `invalid`    – soubor se přečetl, ale obsahuje vzor, který nejde zkompilovat
 *                  (matcher by házel). Scan poběží bez něj – degradace nahlas.
 */
export type DirIgnoreResult =
  | { kind: "loaded"; match: DirIgnoreMatcher }
  | { kind: "absent" }
  | { kind: "unreadable"; path: string; code: string }
  | { kind: "invalid"; path: string };

/**
 * Strop na délku JEDINÉ řádky .gitignore. Reálné glob vzory mají desítky znaků;
 * řádka o tisících znacích je patologická (generovaná/poškozená). `ignore` z ní
 * staví jeden velký regex a V8 ho buď kompiluje celé VTEŘINY, nebo (nad ~35 000
 * znaky) zamítne jako "Invalid regular expression: too large" – a hodí LÍNĚ, až
 * při prvním `test()`. To by uvnitř scanTree (jinak plně defenzivní, na vstupu
 * nehází) shodilo celou analýzu místo slíbené degradace (nález 6-1). Takovou
 * řádku proto odmítneme JEŠTĚ PŘED kompilací: degradace je nahlas a hlavně
 * RYCHLÁ, ne mnohavteřinové zaseknutí. 4096 je hluboko pod pásmem, kde kompilace
 * regexu zpomaluje, a řádově nad jakýmkoli reálným vzorem.
 */
const MAX_GITIGNORE_LINE = 4096;

/**
 * Strop na CELKOVOU velikost .gitignore. `MAX_GITIGNORE_LINE` chytá JEDNU obří
 * řádku, ale ne druhý tvar patologie: desetitisíce KRÁTKÝCH řádek. `ignore` z
 * každé řádky staví vlastní regex a `test()` je iteruje – náklad roste s počtem
 * řádek. Naměřeno: ~256 KiB ≈ 66 ms, 1 MiB ≈ 225 ms, 6 MiB ≈ 1,3 s, a to NA KAŽDÉ
 * složce (loadDirIgnore se volá per-adresář). Bez tohoto stropu by vygenerovaný/
 * poškozený .gitignore zasekl scanTree na vteřiny – přesně to, čemu se má rychlou
 * degradací předejít. 256 KiB je řádově nad jakýmkoli reálným .gitignore (i velká
 * monorepa mají desítky KiB) a drží worst-case kompilaci do ~70 ms.
 */
const MAX_GITIGNORE_BYTES = 256 * 1024;

/**
 * Načte `<absDir>/.gitignore` a vrátí matcher pro scanTree. Voláno na KAŽDÉ
 * vstoupené složce (kořen i podsložky) – vnořená pravidla platí pro svůj podstrom,
 * vzory relativní k té složce. Čistě READ-ONLY – soubor jen čte, nikdy nepíše
 * (non-goal č. 1).
 */
export async function loadDirIgnore(absDir: string): Promise<DirIgnoreResult> {
  const file = path.join(absDir, ".gitignore");

  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { kind: "absent" }; // soubor není → ticho
    return { kind: "unreadable", path: file, code: e.code ?? "neznámá chyba" };
  }

  // Prázdný / jen bílé znaky → žádné efektivní pravidlo. Vracíme `absent`, ať se do
  // zásobníku nepřidá matcher bez vlivu (výstup stejný jako bez .gitignore).
  if (content.trim().length === 0) return { kind: "absent" };

  // Patologicky velký soubor (desetitisíce krátkých řádek) → invalid PŘED kompilací
  // (viz MAX_GITIGNORE_BYTES). Druhá osa obrany vedle limitu na délku řádky.
  if (content.length > MAX_GITIGNORE_BYTES) {
    return { kind: "invalid", path: file };
  }

  // Patologicky dlouhá řádka → invalid JEŠTĚ PŘED kompilací (viz
  // MAX_GITIGNORE_LINE). Tím se vyhneme jak mnohavteřinové kompilaci, tak línému
  // throwu z `test()`, který by jinak shodil scanTree.
  if (content.split(/\r?\n/).some((line) => line.length > MAX_GITIGNORE_LINE)) {
    return { kind: "invalid", path: file };
  }

  // allowRelativePaths: matcher se volá na cestách stavěných z reálných jmen
  // souborů. `ignore` jinak na některé tvary (např. cesta jako ".") HÁŽE; scanTree
  // ale musí zůstat plně defenzivní (nehází na vstupu), tak validaci uvolníme –
  // matching pro normální relativní cesty se tím nemění, jen se přestane házet.
  const ig = ignore({ allowRelativePaths: true }).add(content);

  const match: DirIgnoreMatcher = (relToBase, isDir) => {
    // Prázdná cesta = "sám adresář, kde .gitignore leží". Ten se vlastními pravidly
    // ignorovat nemá (a scanTree sem stejně posílá jen DĚTI, ne základnu); navíc
    // `ignore` na prázdné/"." cestě háže. Pojistka: žádný názor.
    if (relToBase === "") return { ignored: false, unignored: false };
    // Adresář zkoušíme s koncovým "/" – tím zabere i vzor "vendor/" (dir-only)
    // a zároveň vzor bez lomítka ("vendor") matchuje obojí.
    const probe = isDir ? `${relToBase}/` : relToBase;
    const r = ig.test(probe);
    return { ignored: r.ignored, unignored: r.unignored };
  };

  return { kind: "loaded", match };
}
