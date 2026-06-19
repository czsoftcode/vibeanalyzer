# Phase 25 — Filtr minifikátů z ESLint vrstvy

**Goal:** Vytáhnout sdílený detektor minifikátů (.min.* podle jména) do vlastního modulu, použít ho v secrets.ts i v ESLint analyzátoru tak, aby se minifikované soubory do lintu vůbec neposílaly, a report explicitně uvedl počet přeskočených minifikátů (žádné tiché vynechání). Detekce jen podle jména je v1 omezení – bundly bez .min. přípony (bundle.js) projdou; přiznat v reportu.

## Steps
- [done] Sdílený modul detektoru minifikátů
- [done] Přepojit secrets.ts na sdílený detektor
- [done] ESLint vrstva minifikáty nelintuje + počítadlo
- [done] Report uvede počet přeskočených minifikátů
- [done] e2e cli test + nezávislý self-review

## Auto-commit
- Phase 25: Filtr minifikátů z ESLint vrstvy

## Run report
---
phase: 25
verdict: done
steps:
  - title: "Sdílený modul detektoru minifikátů"
    status: done
  - title: "Přepojit secrets.ts na sdílený detektor"
    status: done
  - title: "ESLint vrstva minifikáty nelintuje + počítadlo"
    status: done
  - title: "Report uvede počet přeskočených minifikátů"
    status: done
  - title: "e2e cli test + nezávislý self-review"
    status: done
verify:
  - title: "Vzhled poznámky o přeskočených minifikátech v reálném reportu"
    detail: "Strojově ověřeno, že text v .md i v rychlém přehledu je (testy). Lidským okem stojí za kouknutí, jestli formulace blockquote poznámky a summary řádku dává v reálném reportu smysl a nepůsobí redundantně vedle sebe."
---

# Phase 25 — report z auto session

## Co se udělalo
Minifikované soubory (`*.min.js`, `*.min.css` apod.) se nově **neposílají do ESLint analýzy**. Důvod: generovaný bundle = buď fatální „Parsing error" jako falešný nález, nebo desítky zásahů korektnostních pravidel → report zaplavený šumem o cizím kódu.

- **`src/minified.ts`** (nový): sdílený detektor `isMinifiedName(name)` (regex `\.min\.[a-z0-9]+$`, case-insensitive). JEDINÝ zdroj pravdy – sdílí ho `secrets.ts` i ESLint vrstva. Bez závislostí (žádný import ESLintu/parseru).
- **`secrets.ts`**: odstraněn privátní `isMinifiedName`, přepojen na sdílený modul. Chování beze změny, existující secrets testy dál procházejí.
- **`analyze/eslint.ts`**: minifikáty se před lintem vyřadí z `targets`, počet se vrací jako nové pole `EslintResult.ran.skippedMinified`. Ošetřen zub: když po filtru zbude 0 cílů, ale minifikáty existovaly → `skipped` s rozlišitelným důvodem („jsou jen minifikované JS/TS"), ne zavádějící „žádné JS/TS".
- **`report/markdown.ts`**: sekce ESLint uvede `> Přeskočeno N minifikátů (*.min.*)` + přiznané v1 omezení. Rychlý přehled v hlavičce taky hlásí počet přeskočených (viz self-review N1 níž).
- `findings.ts` typ rozšířen; `jsonIndex` nese pole 1:1 (žádná změna kódu, jen typ).

## Ověření (strojově, sám)
- `tsc --noEmit` čistý.
- Plná suite: **352 testů prochází**.
- Nové testy: detektor (pozitiva/negativa vč. prázdné přípony), ESLint filtr (`app.min.js` se nelintuje, počítadlo=1; jen minifikáty → skipped; čistý projekt → skippedMinified=0), report (poznámka při N>0, mlčí při N=0, summary řádek), e2e cli (minifikát plný chyb se v reportu nelintuje, žádný nález na něj, počet uveden, exit 0).

## Nezávislý self-review (čerstvý kontext) – nálezy a co s nimi
Pustil jsem red-team sub-agenta na cross-module kontrakt a filtrační cestu. Ověřil mj. reálným pokusem (rozbití regexu → padnou testy u OBOU konzumentů, tj. kontrakt má zuby). 4 nálezy:

- **N1 (should-know) – OPRAVENO + test.** `eslintSummaryLine` hlásil „čistý (0 nálezů)" bez ohledu na přeskočené minifikáty → rychlý přehled (čte se první) tiše obcházel cíl fáze „žádné tiché vynechání". Summary nově hlásí i počet přeskočených. Test přidán.
- **N2 (should-know) – VĚDOMĚ ODLOŽENO do TODO.** Rozsahový nesoulad: minifikáty se filtrují JEN v ESLint vrstvě, ale strom souborů, počet „Souborů", graf modulů a JSON index je dál započítávají → report v jedné sekci bundle přeskočí a o pár řádků níž ho vypíše. To je důsledek vědomého zúžení fáze (s uživatelem domluveno: jen ESLint + sdílený detektor). Sjednocení napříč reportem je nová položka v `mini todo`. Pozn.: v1 omezení (detekce jen podle jména) je v reportu i v `minified.ts` přiznané.
- **N3 (nit) – neopravováno.** Newline v názvu (`c.min.js\n`) obejde regex ukotvený na `$` → minifikát se přesto zlintuje. Exotický vstup, důsledek je degradace do šumu (ne pád, ne únik), sekce používá `sanitizeInline`. Nízká priorita.
- **N4 (nit) – neopravováno.** `secrets.scan.test.ts` fixture cílí na jmenný filtr jen díky krátkému řádku (jinak by zabrala obsahová záloha `MAX_LINE_LENGTH`). Drobná křehkost fixture, ne chyba.

## Co může selhat / na co dát pozor
- **Detekce je JEN podle jména `.min.<ext>`.** Bundly bez té konvence (`bundle.js`, `vendor.js`) filtrem projdou a lintují se dál. Přiznáno v reportu i v kódu. Obsahová detekce (dlouhý řádek) zůstává jen v `secrets.ts`, kam se obsah stejně čte; ESLint vrstva obsah nečte.
- **Rozsah je vědomě jen ESLint** – viz N2. Než se to sjednotí (TODO), report jinde minifikáty počítá.
