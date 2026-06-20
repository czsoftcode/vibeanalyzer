# Phase 49 — glm pro non-goal a logic

**Goal:** Zapojit sdílený unwrapFindings (fence + obal i holé pole) do parseFindings a parseLogicFindings a doplnit explicitní kontrakt tvaru + příklad do SYSTEM_PROMPT a SYSTEM_PROMPT_LOGIC, aby --ai-non-goal --ai-model=glm i --ai-logic --ai-model=glm na malém projektu vrátily reálné nálezy (ne skipped).

## Steps
- [done] Zpevnit SYSTEM_PROMPT (non-goal): kontrakt tvaru + příklad
- [done] Zpevnit SYSTEM_PROMPT_LOGIC: kontrakt tvaru + příklad
- [done] parseFindings a parseLogicFindings přes unwrapFindings
- [done] Testy se zuby pro oba parsery
- [done] Živá akceptační brána glm + adversarial self-review

## Auto-commit
- Phase 49: glm pro non-goal a logic

## Run report
---
phase: 49
verdict: done
steps:
  - title: "Zpevnit SYSTEM_PROMPT (non-goal): kontrakt tvaru + příklad"
    status: done
  - title: "Zpevnit SYSTEM_PROMPT_LOGIC: kontrakt tvaru + příklad"
    status: done
  - title: "parseFindings a parseLogicFindings přes unwrapFindings"
    status: done
  - title: "Testy se zuby pro oba parsery"
    status: done
  - title: "Živá akceptační brána glm + adversarial self-review"
    status: done
---

# Fáze 49 — report z auto session

## Co se udělalo
Symetrické dokončení toho, co fáze 48 zavedla pro `--ai-code`, teď i pro `--ai-non-goal` a `--ai-logic`:

1. **Prompty** (`src/analyze/aiResult.ts`): do `SYSTEM_PROMPT` (non-goal) i `SYSTEM_PROMPT_LOGIC`
   přidán explicitní kontrakt tvaru `{ findings: [...] }` + minimální neutrální příklad jedné
   položky a pokyn vracet čistý JSON bez markdown fence. Příklad každého režimu sedí na jeho
   schéma: non-goal má `nonGoalIndex` (0-based) a nemá `kind`; logic má `kind`, nemá
   `nonGoalIndex`, a `file`/`line` jsou označené jako NEPOVINNÉ.
2. **Parsery**: `parseFindings` a `parseLogicFindings` nahradily přímý `JSON.parse(rawText)`
   voláním sdíleného `unwrapFindings(rawText, "(non-goal) "/"(logic) ")` — teď sloupnou markdown
   fence a přijmou obal i holé pole (to, co glm/Z.ai reálně posílá). Striktní validace polí
   pod tím se NEMĚNILA (žádné defaultování severity ani místa).
3. **Testy se zuby** (`aiResult.test.ts`): pro oba parsery přibylo: holé `[...]` == obal
   `{findings:[...]}`, sloupnutí fence, odmítnutí chybějící i neplatné severity; u logic navíc
   špatný typ `line`. Existující obalové testy zůstaly beze změny a procházejí.

## Ověřeno mechanicky
- `npx tsc --noEmit` čistý.
- Celá sada: **571 testů prošlo** (55 souborů). `aiResult.test.ts`: 85 testů.
- Nezávislý adversarial sub-agent (čerstvý kontext): **žádný blocker**. Potvrdil zpětnou
  kompatibilitu opus/sonnet (`unwrapFindings` je nadmnožina původního chování — nenašel
  vstup, který by starý parser přijal a nový odmítl), zuby testů ověřil reálnou mutací zdroje
  (rozbití unwrap zabilo 35 testů, vyřazení validace severity 6), a sednutí příkladů na schéma
  každého režimu. Dva ne-blokující nity: (a) kdyby model zkopíroval placeholder
  `"error|warning|info"` doslova, striktní validace ho ODMÍTNE → čistá degradace se stackem,
  ne tiché selhání (stejný vzor jako fáze 48, ne regrese); (b) `stripJsonCodeFence` sloupne jen
  vnější fence, ne text okolo JSONu — hranice tolerance, kterou tato fáze vědomě nezvyšuje.

## Živá brána glm (proběhla, cíl splněn)
Uživatel načetl `ZAI_API_KEY` přes `source`, takže jsem oba placené živé běhy spustil na malém
testovacím projektu (CLI kalkulačka s úmyslným `eval` = porušení non-goalu a chybějícím
odčítáním = logická mezera):

- **`--ai-non-goal --ai-model=glm`**: 1 nález, NEskončilo skipped. Nález `index.js:9` →
  `eval(expr)` ve funkci `compute`, správně navázaný na non-goal 0 (eval). Tokeny 748+221,
  ~$0.0020.
- **`--ai-logic --ai-model=glm`**: 1 nález, NEskončilo skipped. Nález `index.js:16` → chybí
  slíbené odčítání, else větev místo toho volá eval. Tokeny 965+3698, ~$0.0176.

Oba nálezy míří na konkrétní, ověřitelný řádek (obrana proti halucinaci drží) a režimy se po
zpevnění promptu už nepřeskakují. Testovací projekt jsem po ověření smazal.

## Riziko, které živá brána může odhalit
Pokud glm i po tvrdším promptu vynechá `severity` (nebo u non-goal `nonGoalIndex`), nález se
ODMÍTNE → režim zase `skipped`. Řešení NENÍ defaultovat hodnoty (fabrikace), ale dál zesilovat
prompt. Úplná spolehlivost glm bez vynuceného schématu není zaručená — to je vědomý kompromis.
