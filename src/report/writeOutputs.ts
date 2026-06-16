import { unlink, writeFile } from "node:fs/promises";

/**
 * Zapíše párový výstup (JSON + MD). Soubory jsou pár – buď oba, nebo žádný;
 * při jakékoli chybě se oba cílové soubory bezpodmínečně best-effort smažou.
 *
 * Proč bezpodmínečně obě cesty (a ne jen "co se stihlo úspěšně zapsat"):
 * `writeFile` otevírá soubor s O_CREAT|O_TRUNC, takže soubor na disku VZNIKNE
 * už při open – ještě před samotným `write`. Když write selže až potom (plný
 * disk ENOSPC, kvóta EDQUOT, EFBIG, I/O chyba EIO – právě ty realistické důvody
 * selhání), soubor existuje, i když promise rejectne. Sledovat "úspěšně zapsané"
 * cesty by tenhle osiřelý/částečný soubor minulo. Proto úklid cílí obě cesty
 * nepodmíněně; neexistující soubor dá ENOENT, který spolkneme.
 *
 * Atomicita přes dva renamy není dosažitelná (druhý rename může selhat stejně),
 * proto best-effort úklid; i ten může selhat (právě odebraná práva na adresář) –
 * pak osiřelý soubor zůstane. Chybu zápisu funkce propaguje dál (volající ji
 * přeloží na hlášku a exit kód). Vrací `void`.
 */
export async function writeReportFiles(
  jsonPath: string,
  jsonContent: string,
  mdPath: string,
  mdContent: string,
): Promise<void> {
  try {
    await writeFile(jsonPath, jsonContent, "utf8");
    await writeFile(mdPath, mdContent, "utf8");
  } catch (err) {
    // oba soubory mohly vzniknout už při open – smaž obě cesty bezpodmínečně
    await unlink(jsonPath).catch(() => {});
    await unlink(mdPath).catch(() => {});
    throw err;
  }
}
