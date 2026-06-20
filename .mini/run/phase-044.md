---
phase: 44
verdict: done
steps:
  - title: "Přepínače: --ai → --ai-non-goal, přidat --ai-code"
    status: done
  - title: "Code analýza: prompt + schéma + čisté funkce + orchestrátor (aiResult.ts)"
    status: done
  - title: "Report nese oba AI výsledky odděleně"
    status: done
  - title: "Zapojení v cli.ts"
    status: done
  - title: "Doběh: tsc + suite + reálný běh + nezávislý sub-agent"
    status: done
verify:
  - title: "npm run typecheck (s testy) má 22 předexistujících TS2532 v testech"
    detail: "noUncheckedIndexedAccess hlásí 'Object is possibly undefined' u f[0]/seen[0] indexace v testech (aiResult.test, cli.ai.test, aiPayload.test). Sub-agent ověřil checkoutem HEAD~1, že to NENÍ regrese fáze 44 – typecheck byl rozbitý už dřív. Produkční `npx tsc --noEmit` je ČISTÝ a `npx vitest run` zelený (498). Fáze pár instancí stejného vzoru přidala (konzistentně se zbytkem souboru). Doporučení: uklidit samostatně, je to dlouhodobý dluh, ne věc téhle fáze."
---

# Phase 44 — report z auto session

## Co se udělalo
Přidán samostatný AI režim `--ai-code` (analýza kvality/rizik kódu) oddělený od non-goalů.
Dnešní `--ai` přejmenován na `--ai-non-goal`. Oba režimy běží na vlastní přepínač, sdílejí
jeden klíč i JEDEN payload (čtení souborů proběhne jednou), ale každý volá API zvlášť
(vlastní cena). Report (markdown + JSON, verze 13→14) nese oba výsledky odděleně přes nový
typ `AiReport { nonGoal, code }`. `--ai-logic` vyčleněn do `mini todo`.

## Reálný běh (empirická čísla pro Fázi 5c)
`--ai-code` na opus-4.8 nad tímto projektem (38 zdrojových souborů):
- **usage: 91 673 vstup + 13 157 výstup tokenů, cena ~$0,79**
- 3 nálezy, každý míří na konkrétní místo (runIsolated.ts:56 „riskantní vzorec", :133
  „race condition", resolveImport.ts:11 „logická chyba") – kontrola místa i mapování
  `kind→rule` fungují na reálných datech.

To je podklad pro 5c: kompletní code analýza tohoto (malého) projektu = jednotky korun.

## DŮLEŽITÉ: reálný běh odhalil bug, který testy s mockem nechytly
`realAiAnalyze` měla schéma strukturovaného výstupu NATVRDO (`FINDINGS_SCHEMA` s
`nonGoalIndex`). `--ai-code` tak posílal CODE prompt, ale NON-GOAL schéma → model vrátil
tvar bez `kind` → `parseCodeFindings` ho odmítl („nález má neočekávaná pole") a degradoval
na skipped. Unit/e2e testy to zamaskovaly, protože mockují `analyze` a vracejí už správný
tvar – obcházely tím reálné schéma. **Oprava:** `AnalyzeFn` nově bere `schema` jako
parametr; `runAiAnalysis` předá `FINDINGS_SCHEMA`, `runAiCodeAnalysis` `CODE_FINDINGS_SCHEMA`.
Přidány testy se ZUBY (unit i e2e), které ověřují, že každý orchestrátor předá své schéma –
kdyby se bug vrátil, padnou. Po opravě reálný běh prošel (čísla výše).

## Nezávislý sub-agent (self-review čerstvým kontextem)
Našel 1 reálný nález: `jsonIndex.test.ts:136` jsem při hromadné náhradě minul (`graph, noAi)`
místo `noGraph, noAi)`), takže předával starý tvar – opraveno. Jinak potvrdil: degradace +
exit kódy OK, rozsah catch OK, kontrola místa (obrana proti halucinaci) identická s
non-goal cestou, tajemství neuniká, payload se čte jednou, nevyžádaný režim zůstává `ready`.

## Co zůstává otevřené (zaznamenáno v mini todo)
- `--ai-logic` (analýza funkčnosti celku vůči záměru) – samostatná fáze.
- `classifyAiError` nezná `overloaded_error` (HTTP 529). Při prvním reálném běhu API
  vrátilo „Overloaded" a probublalo jako „nečekaná chyba" se stackem místo čisté degradace.
  Degradace ale FUNGUJE (exit 0, report vznikl) – jde o čistotu klasifikace sdílené vrstvy
  (týká se i pingu/non-goalů), proto NEřešeno narychlo tady, ale jako samostatný úkol.

## Stav bran
- `npx tsc --noEmit` (produkční): čistý.
- `npx vitest run`: 498 testů zelených (přibyly 2 se zuby na schéma-bug).
- viz `verify` k `npm run typecheck` (předexistující dluh, ne regrese).
