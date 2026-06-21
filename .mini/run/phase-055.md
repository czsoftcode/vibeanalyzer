---
phase: 55
verdict: done
steps:
  - title: "Realistický odhad v aiEstimate.ts"
    status: done
  - title: "Řádek realistického odhadu ve výpisu"
    status: done
  - title: "Brána porovnává costTypicalUsd"
    status: done
  - title: "Testy estimateAiCost (sanity)"
    status: done
  - title: "Testy brány se zuby (cli.aicost.test.ts)"
    status: done
  - title: "Zelený typecheck/testy + nezávislý self-review"
    status: done
---

# Phase 55 — report z auto session

## Co se udělalo
- `aiEstimate.ts`: přidána globální konstanta `OUTPUT_TYPICAL_TOKENS_PER_MODE = 16000` (s komentářem o smyslu i undershoot riziku), nové pole `costTypicalUsd` v `AiCostEstimate` a jeho výpočet v `estimateAiCost` (vstup + typical × modeCount). `formatCostEstimate` přidal řádek „realistický odhad: ~$X (na tohle se dívá práh)".
- `cli.ts`: brána (ř. 589) teď porovnává `estimate.costTypicalUsd > AI_COST_CONFIRM_THRESHOLD_USD` místo `costMaxUsd`. Aktualizován zastaralý komentář u prahu (dřív tvrdil „porovnává se proti HORNÍ mezi") a hláška dotazu (dřív „Odhad nejhoršího případu…" → „Realistický odhad ceny…"). Práh $0.50 beze změny.
- Testy: `aiEstimate.test.ts` (sanity + přímý důkaz bug-fixu: glm 1 režim nulový vstup je realisticky pod prahem, worst-case nad), `cli.aicost.test.ts` (kontraktní hranice na `costTypicalUsd`, e2e zuby (g) glm 3× malý projekt → bez dotazu, (h) glm velký vstup → brána se přesto spustí přes vstupní cenu).

## Stav ověření
- `npm run typecheck` zelený.
- Celá sada: 611 testů zelených (57 souborů).
- Zuby ověřeny mutací: dočasné vrácení brány na `costMaxUsd` shodilo test (g) (`ask` se zavolal) → po vrácení zase zeleno.
- Nezávislý sub-agent (čerstvý kontext) potvrdil: nic blokujícího ani vážného; invariant `costMin ≤ costTypical ≤ costMax` drží napříč modely (u opus/sonnet `typical == strop`, proto `toBeCloseTo`, ne `toBeLessThan`); kontrakt estimateAiCost ↔ práh testován proti reálnému kódu, ne mocku.

## Vědomý kompromis (ne chyba)
glm jede `reasoningEffort:high` → thinking se účtuje jako výstup a může 16k překročit (reálný běh klidně ~60k tok. ≈ $0.80). Brána se pak nezeptá, ač účet přeleze práh. Worst-case `costMaxUsd` ale zůstává VYTIŠTĚNÝ ve výpisu (rozsah „až nejvýš $Y"), takže uživatel ho vidí — jen ho neotravujeme dotazem. Tohle je smysl fáze, ne regrese.

## Pozor pro budoucnost
- `OUTPUT_TYPICAL_TOKENS_PER_MODE` je heuristika bez tvrdých dat o reálném výstupu glm. Kdyby se ukázalo, že glm běžně píše víc, je to první kandidát na úpravu (případně per-model, pokud by se data lišila).
- Sanity test invariantu používá `toBeCloseTo(costMaxUsd)` pro opus, protože tam `typical == strop`. Kdyby se opus/sonnet strop někdy zvedl nad 16000, změní se to na `toBeLessThan` — testy by jinak začaly lhát.
