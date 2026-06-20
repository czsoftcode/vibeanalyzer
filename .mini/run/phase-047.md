---
phase: 47
verdict: partial
steps:
  - title: "Provider tabulka + glm do typů a args"
    status: done
  - title: "Model-aware detectAiStatus s dynamickým důvodem"
    status: done
  - title: "Nápověda na klíč jiného providera"
    status: done
  - title: "Klient na Z.ai baseURL podle modelu"
    status: done
  - title: "Protáhnout model do gatingu, ping na Anthropic"
    status: done
  - title: "Živý běh glm, help, self-review"
    status: done
verify:
  - title: "Reálný --ai-code/--ai-non-goal/--ai-logic s glm na vlastním projektu"
    detail: "Ověřeno živým během (tiny projekt + reálný ZAI_API_KEY): glm endpoint odpovídá a běh nepadá (exit 0, report vznikne). NEověřeno na velkém/reálném projektu ani ostatní dva režimy s glm – degradace je čistá, ale za běh se PLATÍ a výsledek je dnes vždy 'skipped' (viz nález). glm na ostro nepoužívat, dokud neproběhne follow-up fáze."
---

# Phase 47 — report z auto session

## Co je hotové (wiring kompletní, 552 testů zelených, build čistý)
- **`AI_PROVIDERS`** v `aiStatus.ts` je jediný zdroj pravdy per model (`modelId`,
  `baseURL?`, `keyEnv`, `prices`). Staré tabulky `AI_MODEL_IDS` a `AI_PRICES_USD_PER_MTOK`
  v `aiResult.ts` jsem smazal (žádná zbylá reference – ověřeno grepem i nezávislým
  reviewem). `glm` = `glm-5.2` / `https://api.z.ai/api/anthropic` / `ZAI_API_KEY` /
  ceny 1.4 vstup, 4.4 výstup za 1M tokenů (zdroj docs.z.ai/guides/overview/pricing).
- **Model-aware brána:** `detectAiStatus(env, model="opus")` hlídá klíč providera daného
  modelu; nová nízkoúrovňová `detectKeyStatus(env, keyEnv)` pro ping. Default `opus`
  drží zpětnou kompatibilitu (`detectAiStatus({})` → „chybí ANTHROPIC_API_KEY").
- **Cross-provider nápověda:** chybí-li klíč zvoleného modelu, ale je nastaven klíč jiného
  providera, důvod přeskočení to napoví (… nalezen ZAI_API_KEY – přidej --ai-model=glm?).
  Hodnotu klíče nikdy neprozradí (test na to).
- **Klient na správný endpoint:** `buildAnalyzeClientOptions(apiKey, model)` (vytaženo kvůli
  testovatelnosti) předá `baseURL` z `AI_PROVIDERS`; opus/sonnet `baseURL: undefined` →
  SDK default Anthropic (ověřeno ve zdroji SDK, žádná regrese).
- **Tři run funkce** gatují přes `detectAiStatus(env, model)` a čtou klíč z
  `env[AI_PROVIDERS[model].keyEnv]`. **`--ai-check`/`verifyAiAccess` zůstaly Anthropic-only**
  (haiku, ANTHROPIC_API_KEY) – záměrně přes `detectKeyStatus`, takže reason zůstává PŘESNĚ
  `AI_MISSING_KEY_REASON` a porovnání v cli.ts drží.
- Help (`--ai-model`) i docstring `parseArgs` doplněny o glm. `INDEX_VERSION` zůstává 16
  (glm je jen nová hodnota existujícího string pole `model`, tvar JSON se nemění).
- **20 nových testů se zuby:** provider tabulka, glm gatuje na ZAI (ne ANTHROPIC),
  nápověda na cizí klíč, --ai-check bez glm nápovědy, baseURL výběr, `computeCostUsd(glm)`,
  orchestrátor s `model="glm"` (gate na ZAI + glm ceník), args přijme glm. Jeden test mi
  rovnou chytil, že jsem zapomněl `glm` v runtime poli `AI_MODELS` (mělo zuby).

## Hlavní nález (proč je verdict `partial`, ne `done`)
**Z.ai endpoint NEVYNUCUJE `output_config.format` (JSON schéma).** Živý běh
`--ai-code --ai-model=glm`: API odpovědělo (stop_reason=end_turn, naúčtováno ~952 out
tokenů), vrátilo validní JSON i s top-level `findings` polem, ALE položky uvnitř mají
**vlastní vymyšlená pole** (`type`, `description`, `declarationType`, `identifier`…) místo
našeho striktního schématu (`file`, `line`, `severity`, `message`). Anthropic schéma tvrdě
vynucuje, Z.ai ho bere jako měkký návrh → náš striktní parser (`parseCodeFindings`) odpověď
odmítne. Degradace je čistá: stack na stderr, režim `skipped`, report vznikne, **exit 0**.

Takže glm je dnes plně **zapojený a placený, ale prakticky nepoužitelný** – každý běh
skončí `skipped`. To byl explicitně anticipovaný risk v zadání fáze a rozhodnutí z diskuse
znělo: **NÁLEZ → samostatná fáze, fallback se teď nestaví.** Drby se tedy nemíchá do scope
této fáze.

## Doporučení pro follow-up fázi (mimo rozsah 47)
- Pro glm posílat schéma + příklad tvaru přímo v system promptu a parsovat tolerantněji
  (mapovat/validovat, ne spoléhat na `output_config.format`). Pozor: tolerantní parser je
  riziko halucinací – nálezy musí dál ukazovat na ověřitelné místo v kódu.
- Zvážit i `thinking: { adaptive }` – jestli ho Z.ai ctí, jsem neověřoval; v probe běhu
  to neselhalo, ale není potvrzené.
- `classifyAiError` by mohl tenhle „špatný tvar od kompat-endpointu" zařadit jako čistou
  degradaci místo „nečekané chyby se stackem" (souvisí s todo 12).

## Nezávislý review
Pustil jsem nezávislého sub-agenta (čerstvý kontext) na gating/chybové cesty a kontrakt
model→klíč. Výsledek: **žádný blocker.** Dva nity – zastaralý docstring v args.ts a chybějící
end-to-end test orchestrátoru s glm – jsem oba opravil ještě v této session.
