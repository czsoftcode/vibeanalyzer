---
phase: 50
verdict: done
steps:
  - title: "Per-model request konfig do AI_PROVIDERS"
    status: done
  - title: "realAiAnalyze posílá per-model tvar"
    status: done
  - title: "Per-model zuby v aiAnalyze.test.ts"
    status: done
  - title: "Nezávislý self-review + zelená sada"
    status: done
verify:
  - title: "Reálný běh: --ai-logic --ai-model=glm na reálném projektu vrátí nálezy bez stop_reason=max_tokens"
    detail: "Mechanicky jsem ověřil jen TVAR dotazu (per-model max_tokens/thinking/reasoning_effort přes SDK mock). Že glm reálně doběhne s nálezy mířícími do kódu prokáže až placený běh proti Z.ai – síť ani útraty jsem nespouštěl. Pozor: reasoning_effort honoruje endpoint Z.ai opačně netestovatelně (adaptive tiše ignoroval), takže efekt nízkého effortu uvidíš až na reálné odpovědi."
---

# Phase 50 — report z auto session

## Co se udělalo
Per-model tvar AI dotazu místo plošných konstant:
- `aiStatus.ts`: `AiProvider` rozšířen o `maxTokens`, `thinking` (`{type:"adaptive"}|{type:"enabled"}`) a nepovinný `reasoningEffort`. Hodnoty: opus/sonnet 16000 + adaptive (bez effortu); glm 65536 + enabled + `reasoningEffort:"low"`.
- `aiAnalyze.ts`: `realAiAnalyze` čte tvar z `AI_PROVIDERS[model]`. `reasoning_effort` se přidává do těla volání podmíněným spreadem JEN pro glm (ne cast celého requestu na any). `thinking` se castuje cíleně na `Anthropic.Messages.ThinkingConfigParam` – nutné, protože SDK typ `ThinkingConfigEnabled` vyžaduje `budget_tokens`, který Z.ai u enabled nepoužívá (řídí se přes reasoning_effort). Zrušena exportovaná konstanta `AI_ANALYZE_MAX_TOKENS` (žádný mrtvý import nezbyl).
- Testy: per-model zuby v `aiAnalyze.test.ts` (glm 65536/enabled/low vs opus 16000/adaptive/bez effortu, vč. `"reasoning_effort" in params === false` u Anthropic) + kontrakt přímo nad `AI_PROVIDERS`. Doplněn tvar v `aiStatus.test.ts`.

## Kořen problému (potvrzeno z docs Z.ai)
Ne strop, ale `reasoning_effort`. Z.ai default je „max", takže glm přemýšlel naplno a sežral výstupní strop; náš plošný 16k ho navíc stahoval POD jeho vlastní default (65536). `adaptive` Z.ai nezná a tiše ignoruje. Hlavní páka je tedy nízký effort, 64k je pojistka.

## Co se cestou našlo a opravilo (mimo původní plán)
1. **Netěsný test (`cli.ai.test.ts`):** dva testy gating na Anthropic selhávaly, protože v prostředí je reálný `ZAI_API_KEY` a `findAltProvider` přidával nápovědu „nalezen ZAI_API_KEY". Opraveno hermetickým stubem `ZAI_API_KEY=""` v `beforeEach` (přes `AI_PROVIDERS.glm.keyEnv`, ne magický literál). Nešlo o regresi fáze, ale o latentní defekt odhalený přítomností klíče.
2. **Červený `npm run typecheck`:** `tsconfig.test.json` (zahrnuje testy, na rozdíl od hlavního tsc) hlásil 7× TS2554 – testy volaly `realAiAnalyze` se 4 argumenty místo 5 (chybělo povinné `schema`). Zděděný dluh z dřívějška, ale mé glm testy přidaly další výskyt. Opraveno doplněním zástupného `SCHEMA` do všech 7 volání v `aiAnalyze.test.ts`.

## Nezávislý adversarial review (čerstvý sub-agent)
Verdikt: drobnosti. Mutačně ověřil zuby testů (glm.maxTokens 16000, opus+effort, glm.thinking=adaptive → vždy padne odpovídající test). Cast thinking i podmíněný spread reasoning_effort vyhodnotil jako čisté (opus/sonnet reasoning_effort nedostanou, 4. model bez maxTokens/thinking neprojde tsc – typová pojistka). Jediný nález byl právě červený typecheck (bod 2 výše) – opraven.

## Stav bran
- vitest: 573/573 zelená.
- hlavní `tsc --noEmit` (src): čistý.
- `npm run typecheck` (test config): mé TS2554 v `aiAnalyze.test.ts` pryč, ALE zůstává PŘEDEXISTUJÍCÍ flood TS2532 („Object is possibly undefined") v `aiPayload.test.ts` a `aiResult.test.ts` – nesouvisí s fází 50, je mimo její rozsah. Brána typecheck tím zůstává globálně červená; stojí za samostatnou úklidovou fázi (kandidát na `mini todo`).

## ⚠️ Bezpečnost – akce pro člověka
Při ladění jsem omylem chybnou bash expanzí (`${ZAI_API_KEY:-...}`) vypsal HODNOTU reálného `ZAI_API_KEY` do výstupu session. Klíč je v historii konverzace → doporučuji ho v Z.ai ROTOVAT (zneplatnit + vygenerovat nový).
