# Phase 55 — Práh ceny na realistický odhad

**Goal:** Přidat do aiEstimate.ts per-model realistický (střední) odhad výstupu a vázat na něj práh potvrzení v cli.ts (worst-case rozsah costMaxUsd dál zobrazovat ve výpisu), aby glm netripoval bránu i s nulovým vstupem a brána zase nesla signál; pokrýt testy (glm malý vstup → bez dotazu, reálně drahý běh → dotaz).

## Steps
- [done] Realistický odhad v aiEstimate.ts
- [done] Řádek realistického odhadu ve výpisu
- [done] Brána porovnává costTypicalUsd
- [done] Testy estimateAiCost (sanity)
- [done] Testy brány se zuby (cli.aicost.test.ts)
- [done] Zelený typecheck/testy + nezávislý self-review

## Auto-commit
- Phase 55: Práh ceny na realistický odhad

## Discussion
# Phase 55 — Práh ceny na realistický odhad

## Intent
Brána potvrzení ceny (`cli.ts:587`) dnes porovnává práh proti `costMaxUsd` (worst-case = celý
výstupní strop modelu). U glm je strop 131072 tok. × $4.4/1M ≈ $0.58 → glm cinkne VŽDY, i s
nulovým vstupem (i 1 režim). Brána tím u glm ztratila signál (`--ai-yes` skoro povinné). Cíl:
vázat bránu na REALISTICKÝ (střední) odhad výstupu, ale worst-case `costMaxUsd` dál ukazovat ve
výpisu.

Klíčové zjištění: vstupní složka už dělá většinu signálu sama. glm vstup $1.4/1M × 1,65M znaků
payloadu (≈500k tok.) = ~$0.70/režim, plný payload 3 režimy ≈ $2.10 → bránu spustí vstup sám.
Problém je ČISTĚ v tom, že u malých projektů dominuje výstupní strop. Proto stačí nahradit „strop
výstupu" rozumným fixním odhadem; není potřeba složitý vážený model.

## Key decisions
- Realistický výstup = JEDNA GLOBÁLNÍ konstanta `OUTPUT_TYPICAL_TOKENS_PER_MODE = 16000`
  (ne per-model). Důvod: JSON nálezů je napříč modely podobný, per-model je nadbytečná složitost
  bez dat o thinkingu. 16k = reálná „plná odpověď".
- Práh zůstává `AI_COST_CONFIRM_THRESHOLD_USD = 0.5`. Mění se JEN proti čemu se porovnává
  (realistický odhad místo `costMaxUsd`), ne hodnota.
- Do `AiCostEstimate` přidat realistické pole (např. `costTypicalUsd`) = inputCost +
  (OUTPUT_TYPICAL_TOKENS_PER_MODE × modeCount / 1M) × prices.output. Čistá funkce v `aiEstimate.ts`.
- Brána v `cli.ts:587` porovnává `costTypicalUsd > AI_COST_CONFIRM_THRESHOLD_USD` (místo `costMaxUsd`).
- `formatCostEstimate` PŘIDÁ řádek s realistickým odhadem (na co se brána dívá) vedle dnešního
  rozsahu „řádově $X až nejvýš $Y". Worst-case řádek se NEODSTRAŇUJE.

## Watch out for
- Undershoot: glm jede `reasoningEffort:high`, thinking se účtuje jako výstup a může 16k překročit
  (reálný běh klidně ~60k tok. ≈ $0.80). Brána se pak nezeptá, ač účet přeleze práh. VĚDOMÝ
  kompromis — worst-case `costMaxUsd` zůstává vytištěný, uživatel ho vidí, jen ho neotravujeme
  dotazem. Tohle je smysl fáze, ne chyba.
- Matematika pro kontrolu zubů: glm 1 režim, nulový vstup cinkne až nad ~113k tok. výstupu →
  s 16k je daleko pod prahem. Plný payload glm trips přes VSTUP.
- Testy mají mít zuby (existují `aiEstimate.test.ts`, `cli.aicost.test.ts`):
  (1) glm malý vstup + běžný počet režimů → `costTypicalUsd` pod prahem → `deps.ask` se NEVOLÁ
      (kdyby někdo vrátil bránu na `costMaxUsd`, tenhle test padne — to jsou ty zuby).
  (2) reálně drahý běh (plný/velký payload nebo víc režimů) → nad prahem → `deps.ask` se VOLÁ.
  (3) `estimateAiCost` vrací `costTypicalUsd` mezi `costMinUsd` a `costMaxUsd` (sanity).
- NEpřibalovat odstranění sonnet (todo 22) ani per-model vstupní strop (todo 19) — jiné fáze.
- Self-review: brána je vstupní/chybová cesta (rozhoduje o přeskočení AI) → před reportem pustit
  nezávislého sub-agenta dle CLAUDE.md.

## Run report
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
