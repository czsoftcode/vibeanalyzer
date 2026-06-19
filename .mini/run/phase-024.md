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
