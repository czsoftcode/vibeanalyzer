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
