# Phase 16 — Soulad načítání TS s non-goalem

**Goal:** Odstranit (nebo explicitně a doloženě smířit) spouštění cizího kódu při načítání TypeScriptu z node_modules analyzovaného projektu, aby deklarace 'čte, nespouští' (non-goal č. 1) platila; konkrétní mechanismus (vždy přibalený TS vs. ponechat projektový) rozhodne discuss.

## Steps
- [done] Bump typescriptu na 5.9.3 + zelený build
- [done] loadTypescript: jen přibalený TS, žádné require cizího
- [done] Test se zuby: hostile node_modules/typescript se NESPUSTÍ
- [done] Čtení projektové verze TS (data, ne spuštění)
- [done] Report + IPC: verze v progress, md poznámce, JSON (INDEX_VERSION 4)
- [done] Adversariální self-review (sub-agent) + finální kontrola

## Auto-commit
- Phase 16: Soulad načítání TS s non-goalem

## Discussion
# Phase 16 — Soulad načítání TS s non-goalem

## Intent
Nález 13-2: `loadTypescript` (src/analyze/loadTypescript.ts:32-38) přes
`createRequire(...).resolve("typescript")` + `req(tsPath)` NAČTE a VYHODNOTÍ
`node_modules/typescript/lib/typescript.js` analyzovaného projektu = spuštění cizího
JS, rozpor s non-goalem č. 1 „čte, nespouští". Komentář v souboru ten fakt navíc
zastírá. (Pozn.: i po fázi 15 to platí – TS se sice načítá v izolovaném podprocesu,
ale pořád se cizí JS vykoná, jen v jiném procesu.)

Cíl: přestat spouštět projektový TypeScript. Vždy použít PŘIBALENÝ TS. Aby se
neztratil původní důvod preferovat verzi projektu (přesnost / falešné nálezy z
verzního rozdílu), report transparentně přizná, jakou verzí se typovalo a jakou
projekt používá.

## Key decisions
- **Vždy přibalený TS.** Zahodit větev s `createRequire`/`req(tsPath)`/`realNodeModules`.
  `loadTypescript` se zredukuje na `import("typescript")` (CJS-on-default handling
  zůstává). Žádné `require` cizího kódu → non-goal č. 1 platí. (Bonus: zavírá i plochu
  trojanizovaného node_modules/typescript – ale framing fáze je KONTRAKT, ne bezpečnost.)
- **Transparentnost verze (uživatel chce).** Verzi projektového TS zjistit ČTENÍM
  `<root>/node_modules/typescript/package.json` (`JSON.parse` textu – data, NE spuštění;
  trojanizovaný package.json je inertní). Když se liší od přibalené, report u tsc sekce
  napíše: „typováno přibaleným TS <X>; projekt používá <Y> – posuzuj s tímto vědomím".
  Chybí node_modules / typescript / nečitelný JSON → poznámka se prostě vynechá (žádný pád).
- **Bump přibaleného typescriptu ^5.6.0 → ^5.9.3** (nejnovější 5.x). NE 6.0.x – to je
  čerstvý MAJOR (jen 6.0.2/6.0.3), může rozbít náš build i nálezy a zaslouží vlastní
  migrační fázi. 5.9.3 pokryje recent syntaxi vibe projektů s minimálním rizikem.
- **`LoadedTypescript.source: "project"|"bundled"` je teď zbytečný** (vždy „bundled").
  Nahradit ho verzí použitého TS (`version` = `ts.version`) – progress hláška pak řekne
  „Spouštím tsc (TS 5.9.x) nad N souborů" místo „(bundled)".
- **Report nese dvě verze.** `TscResult` (ran) rozšířit o `tsVersion` (přibalená, použitá)
  a volitelný `projectTsVersion` (přečtený, jen když existuje a liší se). Render v md i
  JSON. **INDEX_VERSION 3 → 4** (cross-module kontrakt).

## Watch out for
- **Bump TS 5.6 → 5.9 může v NAŠEM buildu odhalit novou striktnost / změněné typy** –
  po bumpnutí projet `tsc` build + celou suitu a případné nové chyby opravit (součást fáze).
- **Cross-module kontrakt:** `INDEX_VERSION` (3→4) sdílí jsonIndex + testy; tvar
  `tsVersion`/`projectTsVersion` sdílí tsc.ts ↔ markdown ↔ jsonIndex → konstanta/typ + test
  reálného kódu, ne mock s natvrdo zadanou hodnotou.
- **Ripple do izolace z fáze 15:** přejmenování `source`→`version` se dotkne i
  `StartedMessage` (runIsolated.ts), relaye v `analyzeChild.ts` a `tscProgress` v cli.ts.
  Vyjmenovat a projít všechny, ať se progress hláška neztratí a IPC sedí. `loadTypescript`
  i čtení projektové verze běží UVNITŘ forknutého dítěte (má `root`) – OK.
- **ZUBY klíčového testu:** fixtura s HOSTILE `node_modules/typescript/lib/typescript.js`
  (při require/eval hodí nebo zapíše marker soubor). `loadTypescript` ho NESMÍ spustit
  (žádný marker, žádný throw, vrátí přibalený). Tenhle test by na STARÉM kódu spadl –
  to je důkaz, že fix reálně mění chování, ne jen kosmetiku.
- **Tři stavy tsc vrstvy** (ran / ran s 0 nálezy / skipped) zůstávají; přidání verzí
  nesmí žádný splést. Poznámka o verzi je jen doplněk u „ran", ne nový stav.
- **Parsování projektového tsconfigu přibaleným TS:** neznámá novější compiler option
  může dát falešnou config chybu. Verzní poznámka to uživateli kontextualizuje – pro V1
  přijatelné, neřešit nad rámec.
- **Determinismus:** přibalená verze je teď jediný zdroj pravdy; report ukazuje přesné
  `ts.version`, ne range z package.json.
- **Rozsah:** střední fáze (zjednodušení loadTypescript je malé, ale verzní poznámka +
  INDEX_VERSION bump + ripple do fáze 15 + bump TS a oprava buildu to roztáhne). Nehromadit.

## Run report
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
