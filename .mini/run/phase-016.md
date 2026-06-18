---
phase: 16
verdict: done
steps:
  - title: "Bump typescriptu na 5.9.3 + zelený build"
    status: done
  - title: "loadTypescript: jen přibalený TS, žádné require cizího"
    status: done
  - title: "Test se zuby: hostile node_modules/typescript se NESPUSTÍ"
    status: done
  - title: "Čtení projektové verze TS (data, ne spuštění)"
    status: done
  - title: "Report + IPC: verze v progress, md poznámce, JSON (INDEX_VERSION 4)"
    status: done
  - title: "Adversariální self-review (sub-agent) + finální kontrola"
    status: done
---

# Phase 16 — report z auto session

## Co se udělalo

Nález 13-2 vyřešen: `loadTypescript` přestal načítat (a tím spouštět) projektový
`node_modules/typescript`. Non-goal č. 1 „čte, nespouští" teď platí i pro načítání TS.

- **`loadTypescript()` bez argumentu** – vždy `import("typescript")` (přibalený).
  Zmizel `createRequire`/`resolve`/`req(tsPath)` i pomocník `realNodeModules`.
  `LoadedTypescript.source: "project"|"bundled"` → `version: string` (= `ts.version`).
- **Přibalený typescript ^5.6.0 → ^5.9.3** (NE major 6.0 – to by byla samostatná
  migrace). Build i celá suite na 5.9.3 zelené.
- **Transparentnost verze:** `readProjectTypescriptVersion(root)` ČTE
  `node_modules/typescript/package.json` (`JSON.parse` textu – data, ne spuštění).
  `TscResult` (ran) nese `tsVersion` (povinná) + `projectTsVersion?` (jen když existuje
  a liší se). Report u tsc sekce: „tsc (TS X) proběhl…" + poznámka „typováno přibaleným
  TS X; projekt používá Y" při rozdílu. INDEX_VERSION 3→4.
- **Ripple `source`→`version`** přes izolaci z fáze 15: `StartedMessage.version`,
  relay v `analyzeChild`, `onStart` signatura, `cli.tscProgress` → „Spouštím tsc (TS X)".

## Co je ověřené (mnou, mechanicky)

- **Reálný produkční běh z `dist`** (přes fork z fáze 15) nad projektem s hostile
  `node_modules/typescript` (verze 5.4.0-fake, jehož `lib/typescript.js` při vyhodnocení
  zapisuje marker): progress „Spouštím tsc (TS 5.9.3)", **marker NEVZNIKL** (cizí TS se
  nespustil), report přiznal „typováno přibaleným TS 5.9.3; projekt používá 5.4.0-fake",
  exit 0. Důkaz, že čteme verzi (data), ale modul nespouštíme.
- **Hostile test má zuby:** dočasně jsem do čtení verze přidal `require` projektového
  TS (simulace regrese) → hostile test spadl (marker vznikl). Po obnovení prochází.
- Bump TS 5.6→5.9: build čistý, žádné nové type chyby v našem kódu.
- Celá suite **231/231** (TS 5.9.3), build čistý.

## Adversariální review (nezávislý sub-agent, čerstvý kontext)

Čistý: nenašel cestu, která by porušila non-goal č. 1 (přibalený TS přes statický
import; projektový package.json se jen parsuje jako data – `__proto__`/gettery při
`JSON.parse` neškodí), ani místo, kde by report tiše zalhal (tři stavy tsc drží, verze
se přiznává jen při reálném rozdílu). Jediný **nit** (markdown.ts:72): `tsc (TS ${tsVersion})`
nemá runtime fallback – dnes neakční (žádná cesta nere-renderuje starý uložený JSON;
`tsVersion` je vždy nastaveno na ran větvi). Pohlídat, KDYBY někdy přibylo čtení
uloženého indexu zpět do reportu.

## Pozn. k rozsahu

Žádné nové architektonické rozhodnutí nad rámec toho, co padlo v discuss (vždy přibalený
TS + transparentnost verze + 5.9.3, ne 6.0). ADR fáze tedy netřeba.

INDEX_VERSION skočil 3→4 – konzumenti JSON indexu (zatím nikdo externí) musí počítat
s `tsVersion`/`projectTsVersion` v tsc výsledku.
