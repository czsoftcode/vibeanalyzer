---
phase: 38
verdict: done
steps:
  - title: "Rozlišit ReportPathCollisionError v catch bloku cli.ts"
    status: done
  - title: "Test se zuby: kolize probublá, ne zploští"
    status: done
  - title: "Regrese: I/O chyba dál vrací 1 + hláška"
    status: done
  - title: "Doběh: tsc + celá suite zelené"
    status: done
---

# Phase 38 — report z auto session

## Co se udělalo
- `src/cli.ts` (catch po `writeReportFiles`, ř. ~421): nová první větev
  `if (err instanceof ReportPathCollisionError)` — uklidí jen `createdDir`
  (vytvořený v tomto běhu; kolize hází PŘED zápisem → adresář je prázdný, nález 3-9)
  a chybu **re-throwne**. I/O větev (`ErrnoException` → „výstup nelze zapsat" +
  return 1) zůstala beze změny. Přidán import `ReportPathCollisionError` (ř. 21).
- Řetězec exit kódu (ověřeno red-teamem): `run()` rejectne → `runCli` (cliMain.ts)
  ji chytí, `console.error("Neočekávaná chyba:", err)` vytiskne **stack** a vrátí 1
  → `bin.ts` nastaví `process.exitCode = 1`. Žádná cesta k tichému exit 0.
- `src/cli.collision.test.ts` (nový): mockuje writeOutputs tak, aby `writeReportFiles`
  vyhodila REÁLNOU `ReportPathCollisionError` (re-export přes importOriginal, ať
  `instanceof` v cli.ts míří na touž třídu). 3 testy: run() rejectne konkrétní třídou
  (ne return 1) + nevypíše I/O hlášku; vytvořený prázdný outDir se uklidí; cizí
  prázdný outDir přežije.

## Reálný nález během práce (regrese, opraveno)
Krok „regrese" odhalil, že moje změna rozbila **existující** `cli.writefail.test.ts`:
jeho mock writeOutputs vystavoval jen `writeReportFiles`, ne `ReportPathCollisionError`.
Jakmile cli.ts začal z téhož (mockovaného) modulu používat tu třídu v `instanceof`,
mock ji nedodal → `instanceof undefined` hodil za běhu chybu a 4 testy spadly.
Oprava: mock doplněn o re-export reálné třídy přes importOriginal. Ověřeno, že žádný
další test writeOutputs nemockuje (grep – jen ty dva soubory).

## Ověření zubů (mutace)
Dočasně jsem `instanceof` větev v cli.ts odstranil: **všechny 3** testy v
collision.test.ts padly (run() vrátí 1 / resolve místo rejectu). S opravou projdou.
`rejects.toBeInstanceOf(ReportPathCollisionError)` + `not "výstup nelze zapsat"` dávají
reálné zuby (pin na konkrétní třídu, ne libovolnou chybu).

## Doběh
- `tsc --noEmit`: exit 0.
- Celá test suite: 46 souborů, 389 testů zelených (předtím 45/386 → +collision test).

## Self-review nezávislým sub-agentem (čerstvý kontext)
Fáze sahá na chybovou cestu + mezimodulový kontrakt → red-team proběhl. Potvrdil
správnost exit řetězce, úklidu i zubů. Dva body:
- **N1 (varování, zalogováno do `mini todo`):** `instanceof` přes hranici modulu
  závisí na tom, že každý mock writeOutputs.js re-exportuje třídu; budoucí mock, co
  to zapomene, dostane matoucí `TypeError` za běhu (ne při tsc). Zvážit přesun třídy
  do vlastního nemockovaného modulu (`report/errors.ts`). Nízká priorita, NEřešeno
  v této fázi (scope creep oproti cíli).
- **N2 (nit, jen kontext):** větev je reálným vstupem nedosažitelná (časové razítko
  → kolize nevznikne), spustí ji jen mock. Legitimní obrana budoucího volajícího.

## Pozn. k uzavřenému todo 26
Spolu s touto fází bylo zavřeno todo 26 (úklid createdDir v EISDIR okně) jako
obhajitelné chování + prakticky nedosažitelné (když `createdDir !== undefined`, byl
adresář při vzniku prázdný → mdPath uvnitř nemůže být předem existující adresář).
