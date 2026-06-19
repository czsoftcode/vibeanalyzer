import * as path from "node:path";
import { SOURCE_EXTENSIONS } from "./sourceExtensions.js";

/**
 * Pro příponu Z IMPORTU vrať kandidátské přípony ZDROJE. Klíčová past ESM/TS:
 * importuje se s `.js`, i když zdroj je `.ts` (`import "./scan.js"` → `scan.ts`).
 * Naivní „hledej přesně .js" by dal prázdný graf. Pořadí = priorita hledání;
 * originální příponu zkoušíme taky (čistě JS projekt opravdu má `.js`).
 */
const EXT_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  ".js": [".js", ".ts", ".tsx"],
  ".jsx": [".jsx", ".tsx"],
  ".mjs": [".mjs", ".mts"],
  ".cjs": [".cjs", ".cts"],
  ".ts": [".ts"],
  ".tsx": [".tsx"],
  ".mts": [".mts"],
  ".cts": [".cts"],
};

/**
 * Vyřeší RELATIVNÍ importní specifier na cestu naskenovaného souboru (oddělovač
 * "/", relativní ke kořeni scanu). Vrátí `null`, když cíl není v `scanned`
 * (externí, gitignorovaný, neexistující, nebo necílová přípona jako `.css`/`.json`).
 *
 * Postup: specifier spojíme s adresářem importujícího souboru a znormalizujeme
 * (vyřeší `..`; cesta vedoucí nad kořen vypadne, protože v `scanned` nebude).
 * Pak zkoušíme kandidáty v pořadí:
 *   1. má-li cesta zdrojovou (nebo JS) příponu → substituce přípony (.js→.ts/.tsx …)
 *   2. jinak (extensionless nebo necílová přípona) → `cesta.<ext>` a `cesta/index.<ext>`
 * První kandidát, který je v `scanned`, vyhrává.
 *
 * `scanned` má obsahovat JEN zdrojové soubory (cíl hrany = jiný modul), takže
 * import `./data.json` se přirozeně nevyřeší (json není modul grafu).
 */
export function resolveSpecifier(
  spec: string,
  fromRelPath: string,
  scanned: ReadonlySet<string>,
): string | null {
  const fromDir = path.posix.dirname(fromRelPath);
  let target = path.posix.normalize(path.posix.join(fromDir, spec));
  // `./` → normalize dá "./"; spec končící "/" („./dir/") nechá koncové "/". Ořež,
  // ať `target + ext` nedá "dir//index.ts".
  if (target.endsWith("/")) target = target.slice(0, -1);
  // Import na KOŘEN scanu (`import ".."` z podsložky, `import "."` z kořene)
  // normalizuje na ".". Sada `scanned` má kořenové soubory bez prefixu
  // (`index.ts`, ne `./index.ts`), takže kořen reprezentujeme prázdným řetězcem
  // a kandidáty skládáme bez vedoucího "/". Cesta nad kořen (`..`) zůstává a
  // žádný kandidát se netrefí (uniká z projektu) → null.
  if (target === ".") target = "";

  for (const cand of candidatePaths(target)) {
    if (scanned.has(cand)) return cand;
  }
  return null;
}

function candidatePaths(target: string): string[] {
  const out: string[] = [];
  const ext = path.posix.extname(target);
  const mapped = EXT_CANDIDATES[ext];
  if (mapped) {
    const stem = target.slice(0, target.length - ext.length);
    for (const e of mapped) out.push(stem + e);
  } else if (target === "") {
    // kořen scanu: jen adresářový index bez vedoucího "/" (`index.ts`, …)
    for (const e of SOURCE_EXTENSIONS) out.push(`index${e}`);
  } else {
    // extensionless (`./foo`) nebo necílová přípona (`./foo.css`):
    // soubor `foo.<ext>` i adresářový import `foo/index.<ext>`.
    for (const e of SOURCE_EXTENSIONS) out.push(target + e);
    for (const e of SOURCE_EXTENSIONS) out.push(`${target}/index${e}`);
  }
  return out;
}
