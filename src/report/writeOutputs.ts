import { rename, unlink, writeFile } from "node:fs/promises";

/**
 * Zapíše párový výstup (JSON + MD) tak, aby selhání NEzničilo cílové soubory.
 *
 * Postup: obojí se nejdřív zapíše do dočasných souborů `<cíl>.tmp` ve stejném
 * adresáři (tedy na stejném filesystému jako cíl – nutné, aby `rename` byl jen
 * přejmenování, ne kopie přes hranici FS). Teprve když oba zápisy uspějí, se
 * tempy přejmenují na cílová jména. `rename` cíl přepíše atomicky (per soubor).
 *
 * Proč temp+rename místo přímého zápisu do cíle:
 * `writeFile` otevírá s O_CREAT|O_TRUNC – cílový soubor by VZNIKL/se zkrátil už
 * při open, ještě před zápisem obsahu. Kdyby write selhal až potom (plný disk
 * ENOSPC, kvóta EDQUOT, EFBIG, I/O EIO), zůstal by na disku osiřelý/zkrácený
 * cíl, a navíc bychom přepsali platný report z minulého běhu, i když tenhle běh
 * neuspěl. Se zápisem do tempu se cíl nedotkne, dokud nejsou OBA tempy hotové.
 *
 * Úklid při chybě cílí JEN naše tempy (`unlink` best-effort, ENOENT spolkneme) –
 * nikdy ne cílové soubory. Tím selhání jednoho ze zápisů nesmaže ani nepřepíše
 * existující cíl (řeší nálezy 2-7 a 2-16). Chybu funkce propaguje dál (volající
 * ji přeloží na hlášku a exit kód). Vrací `void`.
 *
 * Zbytková NEúplná atomicita (vědomě přijatá): dva renamy nejsou jeden atomický
 * krok. Když první rename (JSON) uspěje a druhý (MD) selže, zůstane nový JSON +
 * starý/žádný MD – rollback nejde, starý obsah JSON je už přepsaný. Realistické
 * pády (ENOSPC/EDQUOT/EFBIG/EIO) ale nastávají ve fázi zápisu tempu PŘED prvním
 * renamem; rename je jen úprava metadat. Okno je tedy řádově menší než u přímého
 * zápisu. Druhá vědomá mez: tvrdý kill (SIGKILL) mezi zápisem a renamem zanechá
 * `.tmp` soubor – žádný sweep neděláme (lepší leftover než poškozený cíl).
 */
export async function writeReportFiles(
  jsonPath: string,
  jsonContent: string,
  mdPath: string,
  mdContent: string,
): Promise<void> {
  const jsonTmp = `${jsonPath}.tmp`;
  const mdTmp = `${mdPath}.tmp`;
  try {
    await writeFile(jsonTmp, jsonContent, "utf8");
    await writeFile(mdTmp, mdContent, "utf8");
    await rename(jsonTmp, jsonPath);
    await rename(mdTmp, mdPath);
  } catch (err) {
    // uklidíme JEN naše tempy; cílové soubory necháme nedotčené.
    // (po úspěšném renamu už temp neexistuje → unlink dá ENOENT, spolkneme)
    await unlink(jsonTmp).catch(() => {});
    await unlink(mdTmp).catch(() => {});
    throw err;
  }
}
