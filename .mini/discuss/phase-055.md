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
