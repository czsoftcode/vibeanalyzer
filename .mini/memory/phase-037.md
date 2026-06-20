# Phase 37 — Invariant kolidujících cest ve writeReportFiles

**Goal:** writeReportFiles na začátku vyhodí chybu, když by výstupní cesty kolidovaly (jsonPath === mdPath, nebo se cíl shoduje s .tmp druhého), aby budoucí volající nezaměnil/nepřepsal obsah; pokryto testem se zuby.

## Steps
- [done] Guard kolize cest na začátku writeReportFiles
- [done] Vlastní kontraktní chyba se stackem
- [done] Testy se zuby pro 3 kolizní vztahy
- [done] Doběh: happy path + tsc + celá suite zelené

## Auto-commit
- Phase 37: Invariant kolidujících cest ve writeReportFiles

## Discussion
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

## Run report
---
phase: 37
verdict: done
steps:
  - title: "Guard kolize cest na začátku writeReportFiles"
    status: done
  - title: "Vlastní kontraktní chyba se stackem"
    status: done
  - title: "Testy se zuby pro 3 kolizní vztahy"
    status: done
  - title: "Doběh: happy path + tsc + celá suite zelené"
    status: done
---

# Phase 37 — report z auto session

## Co se udělalo
- `src/report/writeOutputs.ts`: přidána exportovaná třída `ReportPathCollisionError`
  (potomek `Error`, vlastní `name`) a funkce `assertNoPathCollision(...)`, která se
  volá jako **první věc** ve `writeReportFiles`, PŘED `try` a před jakýmkoli zápisem.
  Hlídá, že 4 odvozené řetězce (`jsonPath`, `mdPath`, `jsonPath+".tmp"`,
  `mdPath+".tmp"`) jsou po dvou různé. Porovnání holými řetězci, bez `path.resolve`.
- `src/report/writeOutputs.test.ts`: nový describe blok „invariant kolize cest" se
  3 testy (A: `jsonPath===mdPath`, B: `jsonPath===mdPath+'.tmp'`,
  C: `mdPath===jsonPath+'.tmp'`). Každý ověří, že to padne KONKRÉTNÍ třídou
  `ReportPathCollisionError` (ne ENOENT) a že snímek adresáře zůstane beze změny
  (žádný cíl přepsán, žádný leftover).

## Ověření zubů (mutace)
Dočasně jsem guard vypnul a pustil test soubor: **všechny 3 nové testy spadly**
(3 failed | 5 passed), s guardem projdou (8 passed). U případu A bez guardu přijde
ENOENT z druhého renamu, takže pin na konkrétní třídu chyby dává reálné zuby; u B/C
se bez guardu cíl reálně přepíše a chytí to snímek adresáře.

## Doběh
- `tsc --noEmit`: exit 0 (po opravě indexace pole kvůli `noUncheckedIndexedAccess`).
- Celá test suite: 45 souborů, 386 testů zelených. (Build-test, který chvíli padal,
  padal jen kvůli dočasné tsc chybě v guardu — po opravě prošel.)
- ESLint se nepouští jako repo-linter (projekt nemá `eslint.config.js`, ESLint je tu
  knihovna ve strojové vrstvě) → mimo rozsah fáze.

## Self-review nezávislým sub-agentem (čerstvý kontext)
Protože fáze sahá na chybovou cestu a mezimodulový kontrakt, proběhl red-team:
- Potvrdil, že **guard je logicky úplný** (všech 6 párů ze 4 cest pokrývá přesně
  3 reálné korupční vztahy; zbylé jsou nemožné nebo se redukují) a dvojitá iterace
  nic nepřeskakuje ani falešně nehlásí.
- **N1 (varování, opraveno):** komentář v guardu popisoval neexistující „horní
  trojúhelník" optimalizaci — porovnává se obousměrně. Komentář přepsán na pravdu.
- **N2 (varování, zalogováno do `mini todo`):** `cli.ts` (ř. 421) chytí
  `ReportPathCollisionError` do obecného catch a zploští ji na I/O hlášku „výstup
  nelze zapsat" + exit 1, čímž zahodí stack — maskování programátorské chyby jako
  I/O. **Dnes nedosažitelné** (časové razítko → různé přípony `.json`/`.md`, kolize
  nevznikne), proto NEřešeno v této fázi (diskuse rozhodla cli.ts neměnit) a odloženo
  do backlogu.

## Otevřené / k zvážení
- N2 výše (todo): jestli má guard dávat smysl i jako kontrakt pro produkčního
  volajícího, cli.ts by měl `ReportPathCollisionError` chytat zvlášť a nechat
  probublat se stackem. Nízká priorita (mrtvá cesta).
