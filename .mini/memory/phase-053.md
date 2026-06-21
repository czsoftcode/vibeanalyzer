# Phase 53 — Zvednout strop glm na 128k

**Goal:** Zvednout glm maxTokens z 65536 na 131072 (128k, reálný strop výstupu GLM-5.2), aby velké projekty nepadaly na stop_reason=max_tokens a nezahazovaly zaplacený výsledek; ponechat reasoning_effort na high (kvalita uvažování) a opravit zavádějící komentář v AI_PROVIDERS (GLM-5.2 zná jen high/max, ne low/medium/minimal/xhigh); ověřit, že se worst-case odhad ceny (aiEstimate) správně přepočítá a zdokumentovat, že tím vzroste a víc spouští cenovou bránu (souvisí s todo 20).

## Steps
- [done] Zúžit typ a změnit hodnoty glm v aiStatus.ts
- [done] Opravit zavádějící komentáře v aiStatus.ts
- [done] Aktualizovat testy s natvrdo zadanými hodnotami
- [done] Ověřit přepočet odhadu ceny a zdokumentovat dopad na cenovou bránu

## Auto-commit
- Phase 53: Zvednout strop glm na 128k

## Discussion
# Phase 53 — Zvednout strop glm na 128k

## Intent
GLM-5.2 (Z.ai) měl `maxTokens: 65536`, což je jen Z.ai **default**, ne strop modelu. U velkých projektů thinking sežral výstupní rozpočet → `stop_reason=max_tokens` → výsledek se zahodil, ale naúčtoval. Cíl: zvednout strop na **131072 (128k)**, aby model stihl dopsat JSON.

Ověřeno proti živým zdrojům (docs.z.ai / MarkTechPost / DataCamp, červen 2026):
- max output GLM-5.2 = **131072 (128k)**; 65536 je jen default.
- `reasoning_effort` vystavuje **jen `high` a `max`** (Z.ai pro kódování doporučuje `max`). Hodnoty `low/medium/minimal/xhigh/none` jsou Anthropicový výčet, pro GLM **neplatné**.
- thinking je binární `enabled`/`disabled`.

## Key decisions
- `AI_PROVIDERS.glm.maxTokens`: 65536 → **131072**.
- `AI_PROVIDERS.glm.reasoningEffort`: dnes je na disku **`low`** (neplatná, GLM ji tiše ignoruje) → změnit na **`high`**. POZOR: cíl fáze říká „ponechat na high", ale reálně jde o změnu `low` → `high`. Uživatel zvolil `high` vědomě (menší riziko uřezání thinkingem než `max`, byť docs radí `max`).
- Zúžit TS typ `AiProvider.reasoningEffort` na **`"high" | "max"`** (dnes 7 hodnot). Pole je fakticky glm-only (optional, nastavuje ho jen glm), takže zúžení nic nerozbije a kompilátor neplatnou hodnotu chytí.
- Opravit zavádějící komentář v `aiStatus.ts` (~ř. 40-45): povolené hodnoty jsou `high|max`, ne `max|xhigh|high|medium|low|minimal|none`.
- Cenovou bránu (todo 20) v této fázi **NEŘEŠIT** — jen zdokumentovat, že zvednutím stropu vzroste worst-case `costMaxUsd` a brána z fáze 51 se bude spouštět častěji. Práh brány zůstává na todo 20.

## Watch out for
- **Testy s natvrdo zadanými hodnotami spadnou — to je správné, mají zuby.** Přepsat:
  - `src/analyze/aiStatus.test.ts:78` (`maxTokens: 65536`), `:80` (`reasoningEffort: "low"`).
  - `src/analyze/aiAnalyze.test.ts:121` (`max_tokens` 65536), `:123` (`reasoning_effort "low"`), `:132` (`reasoningEffort` `"low"`).
  - `src/analyze/aiEstimate.test.ts:49` komentář zmiňuje „65536 vs 16000" — aktualizovat (`:50` test sám na `toBeGreaterThan` projde).
- `estimateAiCost` (`aiEstimate.ts:55`) bere strop z `provider.maxTokens` → worst-case cena se přepočítá **sama**, žádný duplikát literálu k úpravě. Ověřit, že `outputMaxTokens` reflektuje 131072.
- Zúžení typu na `"high" | "max"`: zkontrolovat, že nikde jinde není přiřazena hodnota mimo tento union (build to chytí; dnes by `"low"` po zúžení neprošlo — proto změna na `high` musí jít ruku v ruce).
- Komentář u `maxTokens` (`aiStatus.ts:24-25`) zmiňuje „64k / Z.ai default 65536" — sladit s novou hodnotou, ať nedriftuje.

## Run report
---
phase: 53
verdict: done
steps:
  - title: "Zúžit typ a změnit hodnoty glm v aiStatus.ts"
    status: done
  - title: "Opravit zavádějící komentáře v aiStatus.ts"
    status: done
  - title: "Aktualizovat testy s natvrdo zadanými hodnotami"
    status: done
  - title: "Ověřit přepočet odhadu ceny a zdokumentovat dopad na cenovou bránu"
    status: done
---

# Phase 53 — report z auto session

## Co se udělalo
- `src/analyze/aiStatus.ts`: `AI_PROVIDERS.glm.maxTokens` 65536 → **131072**, `reasoningEffort` "low" → **"high"**. Typ `AiProvider.reasoningEffort` zúžen ze 7 hodnot na **`"high" | "max"`** (jediné, co GLM-5.2 reálně bere). Opraveny oba zavádějící komentáře (strop vs. Z.ai default; povolené hodnoty effortu).
- Testy aktualizovány na nový kontrakt: `aiStatus.test.ts` (131072/high), `aiAnalyze.test.ts` (max_tokens 131072, reasoning_effort high, + titulek testu).
- `src/cli.ts`: doplněna poznámka u `AI_COST_CONFIRM_THRESHOLD_USD`, že zvednutí stropu zhruba zdvojnásobí worst-case cenu glm a cenová brána se spouští častěji; práh se ZÁMĚRNĚ nemění (todo 20). Záznam aktualizován i v `.mini/todo.md` (položka cenové brány).

## Co vyplavalo (reálná změna, ne zapomenutý literál)
Test `aiEstimate.test.ts` „glm levnější než opus" spadl — a správně. Zvednutím stropu na 131072 (8,2× opus) se **worst-case cena glm OBRÁTILA**: i přes 5,7× nižší cenu za výstupní token vyjde `costMaxUsd` glm **vyšší** než opus (glm ~$1.17 vs opus $0.85 na 2 režimech). Test jsem nepřepsal tak, aby to schoval, ale tak, aby hlídal novou realitu: glm je per-token levnější (`costMinUsd` < opus), ale worst-case (`costMaxUsd`) je vyšší. Tahle inverze je přesně to, co žene cenovou bránu (todo 20).

## Ověření
- `npm run build` (tsc) zeleně.
- Celá sada `npx vitest run`: **603 testů / 57 souborů zeleně**.
- `estimateAiCost` bere strop z `provider.maxTokens` (žádný duplikát literálu) → worst-case se přepočítává sám; ověřeno testy (outputMaxTokens glm > opus, násobení počtem režimů).
- Zuby: dočasné vrácení maxTokens na 65536 shodí 3 testy; neplatná hodnota effortu neprojde už buildem (zúžený union).

## Pozor / poznámka k procesu
Nezávislý red-team sub-agent (čerstvý kontext) proběhl bez BLOKERŮ. ALE: při testu „zubů" si dočasně přepsal `maxTokens` zpět na 65536 a pak soubor **vrátil přes git na HEAD** — čímž smazal moje rozpracované edity v `aiStatus.ts` (ostatní soubory zůstaly s novými hodnotami → dočasný nekonzistentní stav). Zachyceno přes system-reminder o změně souboru, edity v `aiStatus.ts` znovu aplikovány a stav ověřen čerstvým buildem + plnou sadou (viz výše). Poučení: sub-agentovi pro self-review explicitně zakázat jakékoli git-mutující příkazy (checkout/restore).

## Důsledek pro provoz (vědomě odloženo do todo 20)
Cenová brána je teď u glm prakticky permanentní: i 1 režim s nulovým vstupem přeleze práh $0.50 (131072 × $4.4/1M ≈ $0.58). `--ai-yes` je u glm de facto povinné a brána ztrácí signál. Práh se v této fázi NEMĚNÍ — revize patří do todo 20 (vázat na střední odhad, ne na čistý strop).
