import { access } from "node:fs/promises";
import * as path from "node:path";

export interface OutputPaths {
  jsonPath: string;
  mdPath: string;
}

/** Existuje cesta? Injektovatelné kvůli testu bez reálného fs. */
export type PathExists = (p: string) => Promise<boolean>;

const fsExists: PathExists = (p) => access(p).then(
  () => true,
  () => false,
);

/**
 * Najde volnou dvojici výstupních cest `vibeanalyzer-<stamp>[-N].{json,md}`.
 *
 * Proč: dva běhy ve stejné milisekundě dají stejný `stamp`. Zápis reportu jede
 * přes temp+rename a `rename` cíl PŘEPÍŠE – bez téhle pojistky by druhý běh tiše
 * smazal report prvního (nález 1-5). Proto: když JSON NEBO MD se stampem už
 * existuje, zkoušej sufix `-1`, `-2`, … dokud nejsou volné OBĚ cesty zároveň
 * (dvojici držíme pohromadě, ať .json a .md vždy patří ke stejnému běhu).
 *
 * Pojistka: po `maxAttempts` to vzdá a HODÍ. Radši hlasitý pád se stackem než
 * tichý přepis nebo nekonečná smyčka (žádný falešný úspěch).
 *
 * TOCTOU (vědomě přijatá mez): mezi testem existence tady a pozdějším `rename`
 * může jiný proces stejný název vytvořit. U lokálního jednouživatelského CLI to
 * neřešíme – plné řešení by chtělo `O_EXCL` na cílovém souboru, což atomický
 * temp+rename zápis nedovoluje.
 */
export async function resolveOutputPaths(
  outDir: string,
  stamp: string,
  exists: PathExists = fsExists,
  maxAttempts = 1000,
): Promise<OutputPaths> {
  for (let n = 0; n <= maxAttempts; n++) {
    const suffix = n === 0 ? "" : `-${n}`;
    const jsonPath = path.join(outDir, `vibeanalyzer-${stamp}${suffix}.json`);
    const mdPath = path.join(outDir, `vibeanalyzer-${stamp}${suffix}.md`);
    if (!(await exists(jsonPath)) && !(await exists(mdPath))) {
      return { jsonPath, mdPath };
    }
  }
  throw new Error(
    `Nelze najít volný název výstupu pro razítko ${stamp} v ${outDir} ` +
      `(zkusil jsem ${maxAttempts} sufixů).`,
  );
}
