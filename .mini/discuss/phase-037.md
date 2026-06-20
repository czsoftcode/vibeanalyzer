# Phase 37 — Invariant kolidujících cest ve writeReportFiles

## Intent
`writeReportFiles(jsonPath, jsonContent, mdPath, mdContent)` odvozuje temp soubory
jako `jsonPath + ".tmp"` a `mdPath + ".tmp"`. Pokud by volající poslal kolidující
cesty, tempy/cíle by si přepsaly obsah a funkce by místo ochrany data poškodila.
Cíl fáze: převést tuhle tichou korupci na hlasitý throw **před prvním zápisem**
(žádný leftover, žádný dotčený cíl). Dnešní jediný volající kolizi nevyrábí
(časové razítko v názvu) — jde o pojistku pro budoucího volajícího (self-review
fáze 36, N1 / todo 25).

## Key decisions
- **Invariant = 4 odvozené řetězce po dvou různé.** V hře jsou `jsonPath`,
  `mdPath`, `jsonPath+".tmp"`, `mdPath+".tmp"`. Reálně korumpují tři vztahy:
  - `jsonPath === mdPath` (stejný cíl),
  - `jsonPath === mdPath + ".tmp"` (cíl JSON = temp MD → zápis přímo do cíle bez ochrany),
  - `mdPath === jsonPath + ".tmp"` (zrcadlově).
  Pairwise-distinct těchto 4 řetězců pokryje všechny tři jedním checkem.
- **Porovnání holými řetězci**, BEZ `path.resolve`/normalizace. Chytá přesně bug
  z todo; vědomě nechytá `./a.json` vs `a.json` (a stejně by nechytlo symlinky /
  case-insensitive FS → normalizace by dávala falešný pocit úplnosti). Žádná nová
  závislost na `path`.
- **Throw = programátorská chyba se stackem**, NE I/O. Vlastní/jasná `Error`
  s popisem porušeného kontraktu, propaguje se se stackem. Nemaskovat jako I/O
  selhání („výstup nelze zapsat"). (Pozn.: dnešní volající v cli.ts tuhle cestu
  stejně nespustí, takže chování cli.ts neměníme.)
- Guard běží jako úplně první věc ve funkci, před jakýmkoli `writeFile`.

## Watch out for
- **Falešné zuby u případu A (`jsonPath === mdPath`):** i BEZ guardu tenhle případ
  spadne — na druhém `rename` přijde ENOENT. Test, který ověří jen „vyhodí chybu",
  by prošel i po odstranění guardu. Zuby proto musí ověřit:
  1. padne *konkrétní* kontraktní chybou (ne ENOENT / ne libovolnou),
  2. nedotklo se to žádného cíle — předem připravený cíl se známým obsahem zůstane
     beze změny a po sobě nezůstane žádný `.tmp`.
  U případů B/C se bez guardu cíl reálně přepíše → „cíl nezměněn" tam dává skutečné
  zuby samo o sobě.
- Test pokrýt všechny tři kolizní vztahy zvlášť (ne jen `jsonPath === mdPath`).
- Happy path (různé cesty) musí dál procházet — sladit/nerozbít existující testy
  writeOutputs.
- Side-effect při selhání: guard throwne před zápisem → po sobě nesmí nechat ani
  temp, ani půlpár. Ověřit v testu.
