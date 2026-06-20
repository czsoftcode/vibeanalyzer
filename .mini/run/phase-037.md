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
