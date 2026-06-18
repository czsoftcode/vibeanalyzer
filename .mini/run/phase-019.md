---
phase: 19
verdict: done
steps:
  - title: "Experimentální větev + bump na 6.0.3"
    status: done
  - title: "Zkušební build + typecheck"
    status: done
  - title: "Plná testová sada + tvar diagnostik"
    status: done
  - title: "Kompatibilita Compiler API + eslint"
    status: done
  - title: "Go/no-go rozhodnutí (ADR)"
    status: done
---

# Phase 19 — report z auto session

## Výsledek: GO (povýšeno na typescript 6.0.3)

Povýšení proběhlo na dočasné větvi `ts6-spike`. Vše zelené, takže jsem bump přenesl na `main` (`package.json` + `package-lock.json` změněny, instalovaná verze 6.0.3) a dočasnou větev smazal. Změny zatím **necommitnuty** — to řeší `/mini:done` (auto-commit).

## Co jsem zjistil (konkrétní nálezy)

**6.0.3 je reálně nejnovější stabilní verze TS na npm** (vyšla 23. 3. 2026 jako přechodový release před nativním Go kompilátorem v 7.0).

**Krok 1 — instalace:** `npm install typescript@6.0.3 --save-exact` proběhlo čistě, **žádný peer-konflikt**. `@typescript-eslint/parser@8.61.1` má peer rozsah `>=4.8.4 <6.1.0`, takže 6.0.3 spadá dovnitř a deduplikovalo se napříč všemi `@typescript-eslint/*` balíky (ověřeno `npm ls typescript`). (5 preexistujících npm-audit zranitelností je z jiného soudku — viz todo 16, tato fáze je nezvýšila ani nesnížila.)

**Krok 2 — build + typecheck:** `npm run build` i `npm run typecheck` → **0 chyb, 0 deprecation hlášek**.

**Krok 3 — testy:** `npm run test` → **240/240 zelených** (31 souborů). Klíčové: testy se zuby na tvar diagnostik (`tsc.test.ts` 15 testů, `loadTypescript.test.ts`) prošly beze změny → **TS 6.0 nezměnil tvar/text diagnostik**, které report očekává.

**Krok 4 — Compiler API + eslint:** TS 6.0 je dle release notes „API compatible with TypeScript 5.9". Breaking changes jsou výhradně ve **výchozích** hodnotách `tsconfig` (strict-by-default, default target ES2025, deprecace `es3`/`es5`, méně `this`-kontextu). Náš `tsconfig.json` má `strict`, `target: ES2022` i `module: NodeNext` **explicitně** → změny výchozích hodnot na náš build nedopadají; `ES2022` deprecated není. Všechny použité symboly (`createProgram`, `getPreEmitDiagnostics`, `parseConfigFileTextToJson`, `parseJsonConfigFileContent`, `DiagnosticCategory`, `flattenDiagnosticMessageText`, `ts.sys.*`) jsou stabilní veřejné API a jsou ověřeny zelenými testy, které je reálně volají.

## Čím nám 6.0 pomohl
Upřímně **málo**. Pro tenhle nástroj nejsou nové defaulty ani ES2025 lib přínos (cílíme ES2022 explicitně). Hlavní zisk je **být v synchronu s aktuální stabilní řadou** před příchodem nativního TS 7 a mít otestováno, že naše použití Compiler API přechod přežije.

## Trade-off / na co si dát pozor (důvod pro ADR)
Nástroj analyzuje cizí projekty **naším přibaleným TS**, ne jejich vlastní verzí (záměr, viz `loadTypescript.ts`). Skok přibaleného TS z 5.9 na 6.0 **rozšiřuje** rozdíl mezi tím, co nahlásíme my, a co by nahlásil vlastní toolchain analyzovaného projektu — hlavně kvůli strict-by-default a ES2025 lib u projektů, které tyto věci nemají v `tsconfig` explicitně. Tento rozdíl existoval i dříve (proto report uvádí `projectTsVersion`), teď je jen větší. Není to blocker, ale je to vědomé rozhodnutí — proto doporučuju zaznamenat ADR.

## Doporučení dalšího kroku
Před `/mini:done` spusť `/mini:decision` — zaznamenat *proč* GO i přes rozšíření divergence vůči cizím projektům (zvážená a přijatá kompromisní cesta, nedohledatelná z kódu).
