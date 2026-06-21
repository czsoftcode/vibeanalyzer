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
