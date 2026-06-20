/**
 * Vlastní chyby zápisu reportu. Záměrně samostatný, NEmockovaný modul: `cli.ts`
 * dělá `err instanceof ReportPathCollisionError` proti třídě importované odtud,
 * takže rozlišení chyby nezávisí na tom, že každý mock `writeOutputs.js` třídu
 * re-exportuje. (Dřív třída žila ve `writeOutputs.ts`, který testy mockují →
 * zapomenutý re-export by `instanceof` shodil matoucím TypeError za běhu.)
 */

/**
 * Porušení kontraktu volajícího: výstupní cesty (nebo jejich `.tmp`) by si
 * kolidovaly. Vlastní třída, aby šlo v testu i u volajícího odlišit tuhle
 * PROGRAMÁTORSKOU chybu od I/O chyb (ENOENT/ENOSPC…). NEmaskujeme ji jako I/O –
 * propaguje se se stackem, ať budoucí volající vidí, že chybu udělal on, ne disk.
 */
export class ReportPathCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportPathCollisionError";
  }
}
