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
