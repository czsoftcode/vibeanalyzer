# Phase 24 — Graf modulů z importů (Mermaid)

**Goal:** Z naskenovaných .ts/.js souborů vytáhnout statické relativní importy (import … from / export … from s ./ nebo ../), vyřešit je na soubory uvnitř projektu, sestavit orientovaný graf závislostí a vykreslit ho v reportu Mermaidem s limitem uzlů/hran (jako buildFolderDiagram) a poznámkou o oříznutí. V1: jen relativní hrany, externí balíky/bare importy a dynamický import()/require() se nekreslí; fragilita regex parsingu se v reportu přizná.

## Steps
- [done] Extrakce importů přes TS parser
- [done] Sdílená konstanta přípon + resolver na soubory
- [done] Sestavení grafu – inline defenzivní vrstva
- [done] Vykreslení do reportu + JSON index
- [done] Napojení do cli.ts + e2e + nezávislý self-review

## Auto-commit
- Phase 24: Graf modulů z importů (Mermaid)

## Discussion
# Phase 24 — Graf modulů z importů (Mermaid)

## Intent
Přidat novou analytickou vrstvu, která u JS/TS souborů přečte obsah, vytáhne
importy a sestaví orientovaný graf závislostí (kdo koho importuje) mezi soubory
projektu. Vykreslí se jako nová sekce reportu Mermaidem, vedle stávající
"Struktura složek". Spolehlivé, lokální, bez AI.

- Bod grafu = jeden soubor. Šipka A --> B = "A importuje B".
- Kreslí se jen hrany, kde OBA konce jsou naskenované soubory projektu.
- `scanTree` NEČTE obsah souborů (vrací jen strom). Tahle vrstva si obsah čte
  sama – vzor převzít od `scanSecrets` (inline, defenzivní, `readFile`, vlastní
  result `kind`), NE vymýšlet nový.

## Key decisions
- **Extrakce importů přes TS parser, NE regex.** Použít `ts.createSourceFile`
  z PŘIBALENÉHO typescriptu (`loadTypescript.ts` – `await import("typescript")`),
  ne z `node_modules` cíle (rozpor s non-goalem č. 1, jako tsc.ts). Parser jen
  PARSUJE (nevykonává kód) → non-goal č. 1 OK. Výhody proti regexu: žádné falešné
  nálezy z importů v komentářích/řetězcích, zvládne víceřádkové importy. Tím je
  překonána formulace v cíli fáze o "fragilitě regexu, která se přizná" – tu
  ignoruj, metoda je AST.
- **Vždy dostupné:** `typescript` je NAŠE závislost, takže graf funguje i na čistě
  JS projektu bez vlastního TS → zůstává "spolehlivé, bez AI".
- **Běh INLINE** (jako `scanSecrets`), ne v izolovaném procesu (čisté čtení +
  parsování; izolace = zbytečná složitost).
- **Hrany z čeho:** statické `import … from "…"`, side-effect `import "…"`,
  a `export … from "…"`. Dynamický `import()` a `require()` se ve v1 NEkreslí
  (přes AST je to později levné doplnit – zaznamenat jako možné rozšíření).
- **Jen relativní specifiery** (`./`, `../`). Bare/balíkové (`react`, `node:fs`)
  = externí → zahodit. Nevyřešený relativní import (cíl není v naskenované sadě,
  protože je gitignorovaný/neexistuje) → hranu zahodit.
- **Rozlišování přípon:** zdrojové přípony brát z `LINTABLE_EXTENSIONS`
  (`src/analyze/eslintConfig.ts`) = JEDINÝ zdroj pravdy
  (`.js .jsx .mjs .cjs .ts .tsx .mts .cts`). NEpsat nový literál (cross-module
  kontrakt → test nad reálnou konstantou, ne mock).
- **Pojistný strop ANO** (uživatel potvrdil). Vysoký limit (návrh ~3000 uzlů) +
  hlídat i počet HRAN; čistě záchrana před nevykreslitelným/spadlým Mermaidem.
  Běžný projekt se neořízne. Při překročení report napíše "zobrazeno X z Y"
  (vzor: `buildFolderDiagram` truncation hláška).
- **Osamělé soubory NEkreslit, jen VYPSAT.** Soubor bez jediné šipky (žádný
  import dovnitř ani ven, např. `bin.ts`, `version.ts`) se do grafu nedává;
  do reportu jen textový výčet/počet "osamělé moduly".
- **Vykreslení:** Mermaid `graph LR` (jako `buildFolderDiagram` – do výšky,
  čitelnější). Label = jméno souboru (pozor na unikátnost při ořezu/duplicitě
  jmen napříč složkami – id přiřadit přes cestu, ne jméno).
- **Napojení:** nová vrstva do `cli.ts` (mezi scan a build, vedle secrets),
  výsledek do `MarkdownInput` (`markdown.ts`) i do `buildJsonIndex`
  (`jsonIndex.ts`), nová `## Graf modulů` sekce v `buildMarkdown`.

## Watch out for
- **HLAVNÍ ZUB – `.js` specifier → `.ts` zdroj.** V ESM/TS se importuje s `.js`
  i když zdroj je `.ts` (tenhle repo: `import "./scan.js"`, soubor `scan.ts`).
  Naivní resolver = prázdný graf i na tomto projektu. Resolver MUSÍ zkoušet:
  (1) přesnou cestu; (2) substituci `.js→.ts/.tsx`, `.jsx→.tsx`,
  `.mjs→.mts`, `.cjs→.cts`; (3) extensionless → append zdrojových přípon;
  (4) adresářový import → `index.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`. Vyřešené cíle
  porovnávat proti SADĚ naskenovaných souborů. Test ověřit na REÁLNÉM repu
  (známé hrany sedí), ne jen na umělém mocku – to je důkaz, že resolver funguje.
- **Exit kódy / skip:** vrstva jako celek prakticky nepadá. Per-soubor chyba
  (`readFile` selhal, parser hodil) → přeskočit TEN soubor a započítat ho do
  "nepřečteno/nezparsováno", NE shodit vrstvu ani celý report. Programovou chybu
  nemaskovat jako I/O (chytat jen `readFile`/parse, ne celý blok). Žádná větev
  nesmí dát tichý falešný úspěch (prázdný graf bez vysvětlení proč).
- **Catch rozsah** v `cli.ts`: stejný defenzivní vzor jako secrets (catch jen pro
  NEČEKANÉ selhání injektovaného běhu, se stackem na stderr → `skipped`).
- **Mermaid label injection:** jména souborů cizího projektu mohou obsahovat
  znaky rozbíjející Mermaid – escapovat (viz `escapeLabel`, ale ta dnes řeší jen
  `"` a `[]` – nález 1-4; pro cesty zvážit víc, hlavně nepustit `]`, `"`, `;`,
  newline). Riziko reálné: kreslí se cizí vstup.
- **Velikost/paměť:** parsování AST každého souboru a zahození – per-soubor,
  bounded. U obřího projektu inline čtení+parse může být pomalé; pojistný strop
  řeší vykreslení, ne čas parsování. Zvážit jen, neřešit izolací ve v1.
- **Cykly:** graf importů může mít cykly (A↔B). Mermaid je vykreslí, nepadá –
  nesnažit se je "rozbalovat".
- **Testovatelnost:** vrstvu injektovat do `run()` (jako `scanSecretsFn`/
  `auditFn` v `RunDeps`), ať testy `cli.ts` nemusí sahat na reálné fs.
- **Non-goaly:** parser nespouští kód (č. 1 OK); `--`/žádný nový config soubor
  (č. o configu OK); jen hlášení, žádný auto-fix (OK).

## Run report
---
phase: 24
verdict: done
steps:
  - title: "Extrakce importů přes TS parser"
    status: done
  - title: "Sdílená konstanta přípon + resolver na soubory"
    status: done
  - title: "Sestavení grafu – inline defenzivní vrstva"
    status: done
  - title: "Vykreslení do reportu + JSON index"
    status: done
  - title: "Napojení do cli.ts + e2e + nezávislý self-review"
    status: done
verify:
  - title: "Vizuální čitelnost Mermaid grafu na GitHubu/VS Code"
    detail: "Mermaid blok jde do .md, ale skutečné vykreslení (čitelnost u 137 hran / 74 uzlů tohoto repa, nepřekřížené šipky) jsem neviděl – ověř v prohlížeči s podporou Mermaid. Syntaxi jsem ověřil jen strukturálně (graph LR, n<id>[\"cesta\"], n0 --> n1)."
---

# Phase 24 — report z auto session

## Co je hotové
Nová strojová vrstva „graf modulů" – spolehlivá, lokální, bez AI. Pět nových
souborů + napojení do reportu a CLI:

- `src/analyze/imports.ts` – `extractRelativeSpecifiers(ts, text, ext)` přes
  `ts.createSourceFile`. Bere statické `import…from`, side-effect `import "…"`,
  `export…from`; vynechá dynamický `import()`/`require()`, bare i `node:` importy.
- `src/analyze/sourceExtensions.ts` – jediný zdroj pravdy pro přípony, bez
  těžkých závislostí. `eslintConfig.ts` z něj teď bere `JS/TS_EXTENSIONS`
  (dřív měl vlastní literál) → kontrakt o příponách na jednom místě, a inline
  grafová vrstva si netáhne `@typescript-eslint/parser`.
- `src/analyze/resolveImport.ts` – `resolveSpecifier` se substitucí `.js→.ts/.tsx`
  atd., extensionless, `index.*` a kořenový `import ".."`.
- `src/analyze/moduleGraph.ts` – `buildModuleGraph(root, files)` běží INLINE
  (jako skener tajemství), defenzivní per-soubor, parser cizí kód nevykoná.
- `markdown.ts` (sekce `## Graf modulů` + `buildModuleDiagram` + `escapeNodeLabel`),
  `jsonIndex.ts` (verze 6→7, pole `moduleGraph`), `cli.ts` (vrstva + `RunDeps.moduleGraphFn`).

## Co ověřeno mechanicky
- `tsc --noEmit` čistý, `npm run build` projde, celá sada **344 testů zelená**.
- **Reálný běh nad tímto repem**: 137 hran mezi 74 zdrojovými soubory, hrany
  `cli.ts` přesně sedí na jeho importy včetně HLAVNÍ PASTI `./scan.js` → `src/scan.ts`.
  1 osamělý soubor (`cli.entrypoint.test.ts`, nic neimportuje). Žádné nečitelné/
  nezparsovatelné/velké.
- Testy jsou nad reálným kódem (skutečné soubory v tmpdir, reálný `ts`, reálný
  `resolveSpecifier`), ne nad mocky. Bump verze indexu (7) je ověřen testem.

## Nezávislý self-review (čerstvý kontext) – nálezy a co s nimi
Pustil jsem red-team sub-agenta na chybové cesty a kontrakty. Tři reálné nálezy,
**všechny opravené a pokryté testem**:

- **N1 (should-know):** per-souborový `catch {}` v `moduleGraph.ts` maskoval i
  programovou chybu (TypeError) jako `unparsable`. Zúženo na `RangeError`
  (přetečení zásobníku), zbytek se rethrowuje nahoru → cli degraduje na skipped
  CELÉ vrstvy se stackem. Dva nové testy (RangeError = unparsable; TypeError = probublá).
- **N2 (should-know):** `import ".."` na kořenový `index.*` se tiše nevyřešil.
  Opraveno (kořen = prázdný řetězec, kandidáti bez vedoucího "/"). Dva testy.
- **N3 (should-know):** prázdný graf jen kvůli přeskočeným souborům zněl jako
  „projekt bez importů". Hláška teď stav odliší. Test přidán.
- N4 (nit, neopravováno): `f.size > MAX` spoléhá, že `size` je číslo – `FileEntry.size`
  je typově `number` (ne optional), takže kontrakt drží typem; samostatná oprava
  by byla obrana proti neexistujícímu vstupu.

## Oprava po ručním ověření (Mermaid edge limit)
Uživatel při renderu narazil na chybu Mermaidu „Edge limit exceeded. 500 edges
found, but the limit is 500". Mermaid renderer (GitHub/VS Code/mermaid.js) má
tvrdý default 500 hran a `maxEdges` NEjde přebít zevnitř diagramu (secure config).
Můj původní pojistný strop 6000 hran byl proti tomu k ničemu → velký graf se vůbec
nevykreslil. Opraveno: výchozí strop hran je 480 (pod 500), report v poznámce o
ořezu vysvětluje proč. Nový test (`markdown.moduleGraph.test.ts`) staví 600 hran a
ověří, že se emituje < 500 (přesně 480) – regrese stropu nad limit by spadla.
Celkem **345 testů zelená**.

## Vědomá omezení / možné navazující todo
- **Graf zahrnuje i `.test.ts` soubory.** Jsou to zdrojové soubory a importují
  testované moduly, takže technicky patří do grafu, ale u velkého repa přidávají
  šum (polovina uzlů jsou testy). Filtr testů nebyl v zadání – kandidát na todo.
- Dynamický `import()`/`require()`, externí balíky a `tsconfig` path-aliasy se
  nekreslí – report to explicitně přiznává („graf je přibližný").
- `import x = require("./y")` (TS import-equals) se nebere – vzácné, vynecháno.
- Pojistný strop 3000 uzlů / 6000 hran je vysoký; běžný projekt se neořízne.
  U opravdu obřího repa Mermaid stejně nemusí být čitelný (viz verify).

## Rozhodnutí k zaznamenání
Stojí za `/mini:decision`: během diskuze jsme **zavrhli regex** ve prospěch
parseru z přibaleného TypeScriptu (`ts.createSourceFile`). Důvod (spolehlivost,
žádné falešné nálezy z komentářů/řetězců, vždy dostupné, nevykonává cizí kód) je
netriviální a z kódu samotného později nebude zřejmý.
