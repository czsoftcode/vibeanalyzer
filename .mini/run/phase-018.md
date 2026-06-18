---
phase: 18
verdict: done
steps:
  - title: "Přepnout orientaci diagramu na LR"
    status: done
  - title: "Zvednout strop uzlů z 60 na 1000"
    status: done
  - title: "Srovnat existující testy na LR"
    status: done
  - title: "Test se zuby: plný počet + ořez na hraně"
    status: done
  - title: "Smoke ověření a self-kontrola"
    status: done
verify:
  - title: "Vizuální čitelnost LR diagramu v prohlížeči"
    detail: "Mechanicky jsem ověřil, že výstup začíná 'graph LR' a obsahuje všechny hrany, ale ne, že GitHub/VS Code ho skutečně vykreslí 'na výšku a čitelně'. Otevři vygenerovaný .md report nad reálným projektem a koukni, jestli je LR opravdu čitelnější než původní TD."
  - title: "Renderování velkého grafu (stovky až ~1000 uzlů)"
    detail: "Strop v našem kódu je 1000, ale Mermaid má vlastní pojistku maxTextSize a velmi velký graf může v GitHubu/VS Code renderovat pomalu nebo se useknout. Nemám projekt se stovkami složek po ruce; ověř na reálném velkém projektu, jestli se 1000 uzlů vůbec vykreslí."
---

# Phase 18 — report z auto session

## Co se udělalo
- `buildFolderDiagram` generuje `graph LR` místo `graph TD` (markdown.ts:241). LR skládá sourozenecké složky pod sebe → graf roste do výšky, ne do šířky. Komentář u funkce srovnán (markdown.ts:217-220).
- `DEFAULT_MAX_DIAGRAM_NODES` zvednut z 60 na 1000 (markdown.ts:24). Ořezová logika i poznámka zůstaly beze změny — nad 1000 složek se stále poctivě ořízne (kořen + 999 zobrazených) a report to napíše.
- Tři existující aserce `graph TD` srovnány na `graph LR` (markdown.test.ts). Úmyslný injection vstup `graph TD; HACK` v testu zůstal nedotčený (je to nepřátelský vstup, ne aserce).
- Přidáno 5 nových testů: default-render 200 složek bez ořezu (přes `buildMarkdown`), unit 200 složek se stropem 1000, hraniční ořez na 1001 (truncated, shown=999, poznámka uvádí pravdivý počet i limit), prázdný vstup `[]` → validní mermaid jen s kořenem bez hrany.

## Sebekontrola (CLAUDE.md)
1. **Exit kódy / chybové větve:** fáze nemění žádnou chybovou cestu ani exit kód — čistě renderovací změna (orientace + konstanta). N/A.
2. **Rozsah catch:** nedotčeno, žádný nový try/catch.
3. **Testy mají zuby — OVĚŘENO MUTACÍ:** dočasně jsem vrátil default na 60 → padly přesně 2 teeth testy ("ZUBY default 200 složek" a "hraniční ořez 1001"). Po vrácení na 1000 zase zelené. Netestuju kopii/mock.
4. **Cross-module kontrakt:** ořezová poznámka (řetězec "zobrazeno N z M složek (limit K uzlů)") je testována přes **reálný `buildMarkdown`**, ne přes mock s natvrdo zadanou hodnotou.
5. **Vedlejší efekty při selhání:** žádné — funkce jen staví řetězce, nezapisuje soubory.
6. **Změněná funkce, unhappy path:** prázdný vstup `[]` → validní `graph LR` jen s kořenovým uzlem, žádná hrana (test). Hraniční přetečení stropu (1001) → ořez s pravdivou poznámkou (test).
7. **Dosažitelnost větví:** default-render (<1000 složek, bez poznámky) i ořezová větev (>1000 složek) jsou obě dosažitelné reálným vstupem a obě pokryté testem.

## Co jsem NEdělal a proč
- **Sub-agent adversariální self-review jsem nepouštěl.** Projektový CLAUDE.md ho vyžaduje u fází sahajících na chybové cesty, vstupní body procesu nebo kontrakty mezi moduly. Tahle fáze je čistě kosmetická (jeden literál TD→LR + jedna konstanta), nedotýká se error paths ani process entry. Jediný "kontrakt" je výstupní řetězec poznámky, který je krytý reálným teeth testem. Riziko slepé chyby je nízké — proto jsem oddělený čerstvý kontext nepovažoval za nutný. Pokud chceš, lze přesto spustit `/mini:adversarial`.

## Otevřené body / trade-offy
- **LR není univerzální výhra:** u hlubokého stromu (mnoho úrovní zanoření) by LR naopak rostl do šířky. Pro typický vibe-projekt (mělký, hodně složek) je LR lepší, ale u atypicky hlubokého stromu to může být horší než původní TD. Vědomý trade-off podle zadání.
- **Strop 1000 je kompromis, ne tvrdá pravda o rendereru** — viz `verify` výše.

`/mini:decision` nepokládám za nutné: žádná konkrétní zvážená a zamítnutá alternativa s netriviálním "proč" (volba LR i strop 1000 jsou přímo ze zadání uživatele).
