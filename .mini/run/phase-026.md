---
phase: 26
verdict: done
steps:
  - title: "minified příznak na FileEntry (scan.ts)"
    status: done
  - title: "Graf modulů: minifikáty ven, počítat zvlášť"
    status: done
  - title: "Report: počet + seznam + souhrn grafu"
    status: done
  - title: "JSON index: bump verze 7 → 8"
    status: done
  - title: "Kontraktové testy se zuby + e2e + nezávislý self-review"
    status: done
verify:
  - title: "Vizuální čtení reportu na projektu s minifikáty"
    detail: "Pustil jsem analyzátor na vlastní zdroj (0 minifikátů) – počty/graf bez dovětku sedí. Na projektu, který minifikáty MÁ (např. s app.min.js), jsem report očima nečetl. Doporučuju mrknout, jestli značka v seznamu, dovětek u počtu a řádek u grafu drží pohromadě a čtou se dobře."
---

# Phase 26 — report z auto session

## Co se udělalo
Sjednotil jsem nakládání s minifikáty (`*.min.<ext>`, detekce JEN podle jména) napříč
zbytkem reportu podle rozhodnutí z discuss: **označit, ne mazat** (kromě grafu modulů,
kde se z grafu vyřadí a počítají zvlášť).

- **scan.ts**: `FileEntry` dostal `minified: boolean`, počítá se jednou ve scanu přes
  `isMinifiedName(basename)` (složky vždy `false`).
- **moduleGraph.ts**: minifikáty se z grafu vyřadí (neparsují, nejsou cíl hrany →
  import do bundlu se nevykreslí), nové počítadlo `minified` ve variantě `ran`,
  oddělené od velikostního `tooLarge`.
- **markdown.ts**: počet `Souborů: N (z toho M minifikátů)` (dovětek jen M>0), seznam
  souborů značí minifikát textem `— minifikát (nelintuje se / mimo graf)`, souhrn i
  sekce grafu modulů hlásí počet vyřazených minifikátů.
- **jsonIndex.ts**: `INDEX_VERSION` 7 → 8 (FileEntry.minified + moduleGraph.minified).

Jediný zdroj pravdy o ROZHODNUTÍ zůstává funkce `isMinifiedName`. Report-level
konzumenti čtou předpočítaný `f.minified` ze scanu; eslint/secrets si tu samou funkci
volají samostatně na basename (na týž regex → nemůžou se rozejít). ESLint ani secrets
jsem záměrně nepřepisoval – fungují a mají testy.

## Ověření (mechanicky, sám)
- Celá sada **361 testů zelená**, `tsc --noEmit` čistý.
- **Testy se zuby (proti reálnému kódu, ne mocku):** dočasné rozbití `isMinifiedName`
  (vždy false) shodí testy u scan, moduleGraph, eslint, secrets I e2e CLI; rozbití
  `INDEX_VERSION` shodí jsonIndex test i e2e CLI test čtoucí reálný JSON.
- **e2e CLI** s reálným `vendor.min.js`: report konzistentní napříč počtem, seznamem,
  grafem i JSON; minifikát není uzel/hrana, je započítán.
- **Dogfooding**: běh na vlastním zdroji projde (verze 8, všechny files mají `minified`
  boolean, počty bez dovětku při M=0).

## Nezávislý self-review (čerstvý kontext) – nálezy
Pustil jsem red-team sub-agenta na cross-module a JSON kontrakt. Našel **reálnou díru,
kterou můj checklist minul** (přesně ten blind spot, na který je sub-agent):

- **N1 (should-know) – OPRAVENO + test se zuby.** `allSkipped` v sekci grafu
  (`markdown.ts`) nezahrnoval `mg.minified` do sumy. Projekt JEN z minifikátů
  (`fileCount=0, minified>0`) tak spadl do else větve a lživě hlásil „Žádné importní
  hrany mezi soubory" = tichý falešný „čisto", proti samotnému cíli fáze. Fix: přidán
  `+ mg.minified`, hláška přeformulována na „… nezbyl k sestavení grafu – všechny byly
  přeskočeny nebo vyřazeny". Přidán test, který bez opravy padne.

- **N2 (should-know) – VĚDOMĚ ODLOŽENO do `mini todo`.** Secrets vrstva (`secrets.ts`)
  minifikáty (a velké soubory / dlouhé řádky) tiše přeskakuje bez počítadla –
  `SecretsResult` nese jen `fileCount`. To je nesoulad se zásadou „žádné tiché
  vynechání". ALE: cíl fáze 26 explicitně jmenoval čtyři konzumenty (strom, počet,
  graf, JSON), secrets mezi nimi nebyl; a secrets už dnes tiše skipuje i jiné věci, takže
  oprava jen minifikátů by konzistenci stejně neudělala. Je to samostatná větší věc →
  nový záznam v `mini todo`, ne tiché rozšíření rozsahu.

- **N3 (nit) – neřešeno.** Pluralizace „1 minifikátů" / „1 minifikát". Není to NOVÝ
  nesoulad – kopíruje existující styl báze „1 hran". Řešit by znamenalo i18n plurálů
  (scope creep). Necháno.

- **N4 (nit) – neřešeno.** Newline v názvu (`x.min.js\n`) obejde regex ukotvený na `$`.
  Stejné krajní omezení jako nález N3 z fáze 25, na běžných FS nevznikne. Nízká priorita.

Drobnost: sub-agent upozornil, že můj původní komentář ve `scan.ts` („žádný konzument
regex nederivuje znovu") byl nepřesný – eslint/secrets ho derivují. Komentář opraven.

## Pozn. pro další krok
Žádné zamítnuté návrhové rozhodnutí nad rámec discuss → `/mini:decision` netřeba.
V `mini todo` přibyl follow-up na secrets vrstvu (N2).
