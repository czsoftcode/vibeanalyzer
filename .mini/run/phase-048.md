---
phase: 48
verdict: done
steps:
  - title: "Tvrdší SYSTEM_PROMPT_CODE: explicitní tvar + severity"
    status: done
  - title: "parseCodeFindings přijme holé pole i obal"
    status: done
  - title: "Živá akceptační brána glm + self-review"
    status: done
verify:
  - title: "opus --ai-code se nezměnil novým promptem (živě ověřen jen sonnet)"
    detail: "Regresní sanity jsem pustil živě na sonnet (2 nálezy, exit 0, bez regrese). opus jede stejnou Anthropic cestou se stejným output_config.format, takže je reprezentován – ale samostatný živý opus běh jsem kvůli ceně nedělal. Když budeš opus reálně používat, mrkni, že --ai-code dál vrací nálezy."
---

# Phase 48 — report z auto session

## Výsledek: glm u --ai-code FUNGUJE (akceptační brána prošla)
Živý `--ai-code --ai-model=glm` na malém projektu vrátil **3 reálné nálezy** (ne skipped),
každý s platnou `severity`, ověřeným místem (`src/calc.ts:2`, `:8` – bez značky „místo
neověřeno"), druhem i popisem. Nálezy věcně správné (dělení nulou, chybějící `res.ok`,
URL injection bez encodeURIComponent). Cena ~$0,005. 562 testů zelených, build čistý.

## Jak se to vyvíjelo (dvě vrstvy problému, obě řešené bezpečně)
Diagnóza z diskuse byla jen půlka pravdy. Po jednotlivých opravách se odkryla druhá:

1. **Tvar položek + obal:** `SYSTEM_PROMPT_CODE` nikde neuváděl `severity` ani obal
   `{findings:[...]}` (spoléhal na vynucené schéma, které Z.ai ignoruje). → Přidán
   explicitní kontrakt tvaru + `severity` enum + neutrální příklad s placeholdery. To
   srovnalo vnitřek: glm začal vracet správný obal i severity.
2. **Markdown code fence (odkryto až živým během po opravě 1):** jakmile prompt explicitně
   žádá JSON, glm odpovídá zabalené do ` ```json … ``` ` → `JSON.parse` padl na backticku.
   → `unwrapFindings` teď nejdřív sloupne vnější code fence (`stripJsonCodeFence`), pak
   přijme OBA obaly (`{findings:[...]}` i holé `[...]`). Bezpečná tolerance: jen sjednocuje
   obal, NEvymýšlí ani nemapuje pole – striktní validace položek (vč. severity) zůstala.

Druhá vrstva nebyla v plánu, ale je ve stejné bezpečné třídě (žádná fabrikace) a přímo
v cíli fáze – odkryla ji až živá brána. Do promptu jsem navíc přidal „vrať čistý JSON bez
code fence" (šetří tokeny), ale strip je obranná pojistka bez ohledu na to.

## severity zůstala striktní (žádná fabrikace)
Když položka nemá `severity` nebo má neplatnou, parser HODÍ – žádné defaultování. To drží
princip „každý nález ověřitelný". Pokryto testy se zuby (mutace „dosaď default" zabila 2 testy).

## Co je MIMO rozsah (follow-up)
- `--ai-non-goal` a `--ai-logic`: `parseFindings`/`parseLogicFindings` zůstaly bajt-identické
  (přímý `JSON.parse` bez fence stripu). Pokud u nich glm narazí na fence/holé pole, spadnou
  do `skipped`. `unwrapFindings` je sdílená a exportovaná, takže zapojení do těch dvou je
  levný follow-up (vlastní živá cena za ověření každého režimu).
- `classifyAiError` (todo 12) neřešen: špatný tvar dál probublá jako „nečekaná chyba" se
  stackem a degraduje (exit 0).

## Nezávislý review
Pustil jsem nezávislého sub-agenta (čerstvý kontext) na parser/prompt kontrakt; sám si
odmutoval testy (strip, holé pole, default severity – každá mutace zabila testy). **Žádný
blocker.** Jediné reziduum: pravděpodobnostní vliv příkladu v promptu na opus/sonnet se
schématem – ale příklad má placeholdery (`<číslo>` není integer → schéma i parser by ho
odmítly), takže nejhůř způsobí `skipped`, ne falešný nález. Sanity sonnet běh to potvrdil
(2 nálezy, bez regrese).
