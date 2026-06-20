# Phase 39 — ReportPathCollisionError do vlastního modulu

**Goal:** Přesunout ReportPathCollisionError do nemockovaného src/report/errors.ts; cli.ts a writeOutputs.ts ji importují odtud, takže instanceof přežije i mock writeOutputs bez re-exportu třídy – ověřeno tím, že mock v cli.writefail.test.ts re-export už nepotřebuje a celá suite zůstane zelená.

## Steps
- [done] Vytvořit src/report/errors.ts s ReportPathCollisionError
- [done] writeOutputs.ts importuje třídu z errors.ts
- [done] cli.ts + dva testy importují z errors.ts
- [done] Zub: writefail mock zahodí re-export třídy
- [done] Doběh: tsc + celá suite zelené

## Auto-commit
- Phase 39: ReportPathCollisionError do vlastního modulu

## Run report
---
phase: 39
verdict: done
steps:
  - title: "Vytvořit src/report/errors.ts s ReportPathCollisionError"
    status: done
  - title: "writeOutputs.ts importuje třídu z errors.ts"
    status: done
  - title: "cli.ts + dva testy importují z errors.ts"
    status: done
  - title: "Zub: writefail mock zahodí re-export třídy"
    status: done
  - title: "Doběh: tsc + celá suite zelené"
    status: done
---

# Phase 39 — report z auto session

## Co se udělalo (mechanický refaktor, beze změny chování)
- **`src/report/errors.ts` (NOVÝ):** samostatný nemockovaný modul, jen třída
  `ReportPathCollisionError` (extends Error, vlastní name). Nic neimportuje.
- **`src/report/writeOutputs.ts`:** třídu už nedefinuje ani NEre-exportuje –
  importuje ji z `./errors.js` a dál ji hází v `assertNoPathCollision`.
- **`src/cli.ts`:** import `ReportPathCollisionError` z `./report/errors.js` (dřív
  z writeOutputs.js); `instanceof` v catch beze změny.
- **`src/report/writeOutputs.test.ts` a `src/cli.collision.test.ts`:** import třídy
  z errors.js. Mock writeOutputs v collision testu bere třídu přes
  `await import("./report/errors.js")` uvnitř (async) factory a hází ji.
- **`src/cli.writefail.test.ts`:** mock writeOutputs zjednodušen zpět na prostý
  factory bez re-exportu třídy.

## Proč (řeší self-review N1 fáze 38 / todo 28)
Dokud třída žila ve `writeOutputs.ts`, který oba CLI testy mockují, každý mock ji
musel re-exportovat – jinak `err instanceof ReportPathCollisionError` v cli.ts shodil
za běhu matoucí `TypeError`. Po přesunu do nemockovaného errors.ts na disciplíně
mocku `instanceof` nezávisí.

## Zuby / verifikace
- **Důkaz odpojení (cíl fáze):** writefail mock už třídu nere-exportuje a celá suite
  je dál zelená → `instanceof` na mocku writeOutputs nevisí.
- **tsc:** exit 0. **Celá suite:** 46 souborů, 389 testů zelených (beze změny počtu
  oproti fázi 38 – nic nepřibylo/neubylo, jen refaktor).
- **Sanity:** grep potvrdil žádný zbylý import třídy z writeOutputs.js; errors.ts nic
  neimportuje → žádný cyklus.

## Self-review nezávislým sub-agentem (čerstvý kontext)
Cross-module kontrakt (instanceof napříč moduly + mocky) → red-team proběhl.
Verdikt: refaktor v pořádku, žádný kritický/varovný nález. Sub-agent provedl vlastní
mutace: (a) odebrání `instanceof` větve z cli.ts → 3 collision testy padnou (zuby
drží); (b) přepnutí importu v cli.ts zpět na writeOutputs.js → `tsc` okamžitě chytí
TS2459 (třída se odtud opravdu neexportuje). Čistá ESM (NodeNext, type module) →
žádné CJS/ESM dvojí načtení, jedna reference třídy pro všechny konzumenty.
Dva nezávazné nity (jednoprvkový modul je opodstatněný decouplingem; jméno „errors"
v množném čísle je mírně ambiciózní oproti obsahu) – neměněno.
