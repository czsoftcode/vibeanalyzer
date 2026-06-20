# Phase 33 — Typová kontrola i pro testy

**Goal:** Přidat tsconfig.test.json (dědí z base, ale bez exclude testů, noEmit) a napojit ho na npm run typecheck tak, aby kontroloval i *.test.ts; opravit odhalené typové nesoulady, ať projde zeleně. Build (tsc) dál testy nevypouští do dist. Ověření: záměrná typová chyba v testu (vynechané povinné pole) shodí npm run typecheck; bez ní projde zeleně; npm run build dál neemituje test soubory do dist.

## Steps
- [done] Vytvořit tsconfig.test.json
- [done] Napojit typecheck na nový config
- [done] Opravit reálné nesoulady tvaru (~12: TS2322/2741/2345/2339)
- [done] Opravit přístup k indexům (~41: TS18048/TS2532)
- [done] Zuby + ověření

## Auto-commit
- Phase 33: Typová kontrola i pro testy

## Run report
---
phase: 33
verdict: done
steps:
  - title: "Vytvořit tsconfig.test.json"
    status: done
  - title: "Napojit typecheck na nový config"
    status: done
  - title: "Opravit reálné nesoulady tvaru (~12: TS2322/2741/2345/2339)"
    status: done
  - title: "Opravit přístup k indexům (~41: TS18048/TS2532)"
    status: done
  - title: "Zuby + ověření"
    status: done
---

# Fáze 33 — report z auto session

## Co se udělalo

Cíl: testy se v projektu typově nehlídaly (`tsconfig.json` vylučoval `**/*.test.ts`,
vitest jede přes esbuild = transpile-only). Typová chyba v testu tiše procházela.

**Konfigurace:**
- Nový `tsconfig.test.json`: `extends ./tsconfig.json`, `noEmit:true`, `include:["src"]`,
  `exclude:["dist","node_modules"]` (testy už NEvyloučené). Dědí plnou striktnost včetně
  `noUncheckedIndexedAccess`.
- `package.json`: `typecheck` = `tsc --noEmit -p tsconfig.test.json` (pokryje src i testy).
  `build` (`tsc`) BEZE ZMĚNY → dál jede přes `tsconfig.json`, který testy vylučuje, takže
  do `dist` se test soubory neemitují (ověřeno).

**Opravené reálné nesoulady tvaru (latentní dluh, který kontrola odhalila):**
- `markdown.tsc.test.ts` (7×): ran-literály bez `hoistedNodeModules` (pole z fáze 32,
  vědomě tam tehdy nedoplněné, protože se to netypovalo) → doplněno `false`.
- `findings.test.ts`: ran-literál bez povinného `tsVersion` → doplněno.
- `secrets.scan.test.ts`: helper `fe()` stavěl `FileEntry` bez povinného `minified` (pole
  z fáze 25/26) → doplněno věrně přes `isMinifiedName(relPath)`, jak to dělá scanTree.
- `cli.scanfail.test.ts` (2×): mock `ScanResult` bez povinného `ignoredByGitignore` → 0.
- `eslintConfig.test.ts`: `parserOptions.ecmaFeatures` nešlo přes typ (@eslint/core typuje
  `LanguageOptions` jako `Record<string,unknown>`) → dokumentovaný cast na tvar, který
  sami v `eslintConfig.ts` píšeme.

**Opravený přístup k indexům (~41 TS18048/TS2532 z `noUncheckedIndexedAccess`):**
- Idiom: `assert(x)` z `node:assert` (standardní TS assertion funkce – zúží typ A má zuby:
  při porušení vyhodí → test spadne). Použito v `secrets.test.ts`, `secrets.scan.test.ts`,
  `audit.parse.test.ts`, `markdown.audit.test.ts`. Kde byl jednorázový inline index uvnitř
  castovaného výrazu (audit.parse `.findings[0].severity`), použito `!` – při prázdném poli
  TypeError shodí test (zuby zachovány).

## Ověření (vše strojově)

- `npm run typecheck`: 0 chyb (před fází: 53 v testech).
- `npm test`: 381 testů prošlo (45 souborů), beze změny počtu = opravy nezměnily chování.
- `npm run build`: čistý; `dist/` neobsahuje žádný `*.test.js`.
- **Zuby:** dočasné vynechání povinného pole v ran-literálu (`findings.test.ts`) → `npm run
  typecheck` spadl (exit 2, TS2322); po vrácení 0 chyb. Tj. kontrola reálně chytá to, kvůli
  čemu fáze vznikla.

## Pozor / poznámky pro člověka

- **`src/secrets.scan.test.ts` se v `git diff --stat` jeví jako „Bin 7260 -> 7454"** – NENÍ
  to regrese této fáze: zacommitovaná HEAD verze byla `file`em klasifikovaná stejně („data"),
  moje verze je validní UTF-8 bez NUL bajtů (ověřeno `iconv`/grep). Příčina je dlouhý řádek
  ve fixture (JSON audit report), na který `file`/git diff-heuristika reaguje jako na binárku.
  Obsah je v pořádku, commit bajty zachová.
- Self-review: tato fáze nesahá na produkční chybové cesty, vstupní body ani kontrakty mezi
  moduly (mění jen config + typové anotace v testech). Korektnost je ověřená samotným
  typecheckem + 381 testy, takže nezávislého sub-agenta jsem nepouštěl.

## Pozn. k rozhodnutí

Hraniční volby (striktní `noUncheckedIndexedAccess` i pro testy místo jeho vypnutí v test
configu; `assert` místo rozsévání `!`) byly probrané už v plánu a jsou zřejmé z kódu →
ADR netřeba.
