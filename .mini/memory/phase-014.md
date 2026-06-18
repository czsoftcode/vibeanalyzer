# Phase 14 — Oprava falešného JSX parsing erroru

**Goal:** V JS bloku ESLint flat-configu zapnout parserOptions.ecmaFeatures.jsx, aby validní .jsx/.js s JSX nedávaly falešný 'error' nález, a pokrýt to testem s .jsx fixturou.

## Steps
- [done] Zapnout JSX v JS bloku flat-configu
- [done] Test: .jsx a .js s JSX -> ran bez parsing erroru
- [done] Ověřit, že JSX nerozbil neJSX JS ani TS větev
- [done] Adversariální self-review (sub-agent) + finální kontrola

## Auto-commit
- Phase 14: Oprava falešného JSX parsing erroru

## Run report
---
phase: 14
verdict: done
steps:
  - title: "Zapnout JSX v JS bloku flat-configu"
    status: done
  - title: "Test: .jsx a .js s JSX -> ran bez parsing erroru"
    status: done
  - title: "Ověřit, že JSX nerozbil neJSX JS ani TS větev"
    status: done
  - title: "Adversariální self-review (sub-agent) + finální kontrola"
    status: done
---

# Phase 14 — report z auto session

## Co se udělalo

Nález 13-1 opraven: do JS bloku ESLint flat-configu (`src/analyze/eslintConfig.ts:58`)
přidáno `parserOptions: { ecmaFeatures: { jsx: true } }`. Validní `.jsx` i `.js`
s JSX se teď naparsují a nedávají falešný fatal **`error`** „Parsing error:
Unexpected token <".

Přidán regresní test `src/analyze/eslint.test.ts` („validní JSX v .jsx i .js → ran
bez 'Parsing error'"). Test běží proti reálnému `analyzeESLint` (ne mock).

## Co je ověřené (mnou, mechanicky)

- **Zuby testu:** dočasně jsem opravu vrátil → nový test spadl přesně na
  `/Parsing error/i ... toBe(false)`. S opravou prochází. Test má zuby.
- **Celá suite:** `vitest run` → 209/209 prošlo. `tsc` build čistý.
- **NeJSX kód se nerozbil:** `a < b` i řetězené `a < b > c` v čistém `.js` se
  s `jsx:true` naparsují bez nálezu (empiricky, dočasný test, smazán).
- **Pravý parse error se neschoval:** skutečně rozbitý JSX dál dává nález.
- **TS blok nedotčen:** `.tsx` přes tsParser parsuje JSX korektně.

## Dovětek nad rámec 13-1: vypnuto `no-unused-vars` i na JS (na pokyn uživatele)

Adversariální sub-agent (čerstvý kontext) + můj empirický test odhalily, že
samotná oprava JSX **odemkla novou třídu falešných nálezů na cílovce (React)**:
tím, že se JS soubor s JSX naparsuje, rozběhl se na něm `no-unused-vars`, který
NErozumí JSX použití → na zdravém React kódu hlásil falešné **warningy**
(`'React' is defined but never used`, `'Button' is defined but never used`).

Po prodiskutování s uživatelem (ukázán dopad vypnutí empiricky) padlo rozhodnutí
pravidlo **vypnout i na JS bloku** (`eslintConfig.ts`), stejně jako už bylo na TS:

- Zdravý React `.jsx/.js` → 0 nálezů (ověřeno testem `eslint.test.ts` „zdravý
  React (.jsx) → 0 nálezů, ŽÁDNÝ falešný no-unused-vars"). Test má zuby: po
  zapnutí pravidla zpět spadne (ověřeno).
- Bug-rules (`eqeqeq`, `no-empty`, `no-cond-assign`, …) běží na JS dál — vypnutí
  se jich netýká (ověřeno empiricky).
- `eslintConfig.test.ts` upraven: JS blok teď tvrdí `no-unused-vars: off` +
  nový test, že JS blok má `ecmaFeatures.jsx: true`.

**Přijatý trade-off:** ztrácíme detekci skutečně nepoužitých proměnných/importů
v čistém (neReact) JS — reálný, byť hygienický (ne bug) signál. Pro cílovku
(React vibekodeři) je falešný šum na zdravém kódu horší. Konzistentní s TS blokem.

## Doporučení

Toto je reálné rozhodnutí s trade-offem — doporučuju ho zaznamenat přes
`/mini:decision` (proč jsme `no-unused-vars` na JS vypnuli) **před** `/mini:done`.
