# Phase 47 — Třetí AI model: GLM-5.2

## Intent
Přidat `glm` jako třetí volbu `--ai-model` vedle `opus`/`sonnet` pro tři analytické
režimy (`--ai-code`, `--ai-non-goal`, `--ai-logic`). GLM-5.2 (Z.ai) je výrazně levnější
než opus. Z.ai nabízí Anthropic-kompatibilní endpoint, takže se znovupoužije stávající
`@anthropic-ai/sdk` – jen s jiným `baseURL` a jiným klíčem. Cíl je čistě zapojení
(wiring): id modelu, endpoint, klíč, ceny + protažení volby modelu do detekce klíče.

`--ai-check` (ping) zůstává MIMO rozsah – jede dál jen na Anthropic (haiku, ANTHROPIC_API_KEY).

## Key decisions
- **Provider per model.** Zavést popis providera pro každý `AiModelChoice`:
  `modelId`, `baseURL` (undefined = default Anthropic), `keyEnv`, ceny. Doporučení:
  KONSOLIDOVAT do jedné tabulky místo 4 paralelních Recordů (`AI_MODEL_IDS`,
  `AI_PRICES_USD_PER_MTOK`, nový `keyEnv`, `baseURL`), aby nedriftovaly – jde o
  cross-module kontrakt. Finální tvar rozhodne plan.
- **Konkrétní hodnoty glm:** modelId `glm-5.2`, baseURL `https://api.z.ai/api/anthropic`,
  keyEnv `ZAI_API_KEY`, ceny **vstup $1.4 / výstup $4.4** za 1M tokenů (zdroj:
  docs.z.ai/guides/overview/pricing; cache rate $0.26 kód nemodeluje – počítá flat input).
- **Gating klíče je nově model-aware.** `detectAiStatus(env)` dnes čte natvrdo
  `AI_KEY_ENV="ANTHROPIC_API_KEY"`. Nově musí podle ZVOLENÉHO modelu hlídat příslušný
  keyEnv; `AI_MISSING_KEY_REASON` se stává dynamickým (per keyEnv).
- **Chytřejší nápověda (rozhodnuto):** když chybí klíč vybraného modelu, ale je nastavený
  klíč JINÉHO providera, důvod přeskočení to napoví (např. „chybí ANTHROPIC_API_KEY;
  nalezen ZAI_API_KEY – přidej --ai-model=glm?"). → `detectAiStatus` potřebuje přehled
  všech keyEnvů, ne jen toho vybraného.
- **Plán B při nekompatibilitě (rozhodnuto):** když živý běh ukáže, že Z.ai endpoint
  nectí `output_config.format` nebo `thinking:adaptive`, je to NÁLEZ → samostatná fáze.
  Tolerantní textový parser/fallback se TEĎ NESTAVÍ (vyhnout se scope creepu řešením
  problému, který možná neexistuje).

## Watch out for
- **Největší riziko = proprietární Anthropic parametry.** `realAiAnalyze` posílá
  `output_config: { format: { type: "json_schema", schema } }` a `thinking: { adaptive }`
  – obojí jsou Anthropic rozšíření. Z.ai „kompatibilní" endpoint je ctít NEMUSÍ. Celá AI
  vrstva stojí na vynuceném schématu; když ho endpoint ignoruje, GLM vrátí prostý text /
  chybu → parser daného režimu odmítne. NEJDE ověřit unit testem – jen živým během se
  `ZAI_API_KEY` na malém projektu (`--ai-code --ai-model=glm` → report bez pádu). To je
  akceptační brána fáze.
- **Ping nesmí spadnout.** Změna signatury `detectAiStatus` (model-aware) nesmí rozbít
  cestu `--ai-check`/`verifyAiAccess` – ta zůstává na Anthropic defaultu (haiku,
  ANTHROPIC_API_KEY). Ping volá `detectAiStatus` bez modelu → po změně mu předat
  Anthropic default explicitně.
- **Tři místa v aiResult.ts** (run non-goal/code/logic, ~ř. 209/392/613) čtou
  `env[AI_KEY_ENV]` – musí číst keyEnv ZVOLENÉHO modelu (mají `model` param).
- **Klient v aiAnalyze.realAiAnalyze:** `new Anthropic({ apiKey })` doplnit o `baseURL`
  z provider tabulky podle `model` (undefined u opus/sonnet = default Anthropic). Signatura
  beze změny (model už dostává).
- **`AI_MODELS` v args.ts** += `glm` → automaticky zaktualizuje validaci i chybovou hlášku
  `--ai-model`. `AiModelChoice` union += `"glm"` – sdílený literál args↔cli↔aiStatus↔aiResult.
- **JSON verze:** `glm` je jen nová hodnota existujícího string pole `model` v
  `AiStatus.analyzed` – tvar reportu se nemění → pravděpodobně BEZ bumpu `INDEX_VERSION`.
  Ověřit v plánu (na rozdíl od fází 45/46 to není změna tvaru `ai`).
- **Testy mají mít zuby:** (1) `detectAiStatus` pro glm gatuje na `ZAI_API_KEY`, NE na
  ANTHROPIC; (2) nápověda na cizí klíč; (3) baseURL klienta se pro glm reálně nastaví a
  pro opus/sonnet ne; (4) `computeCostUsd` glm = 1.4/4.4; (5) args přijme `glm`. Testovat
  reálnou sdílenou provider tabulku, ne mock s natvrdo zadanými hodnotami.
- **Adversarial sub-agent:** fáze sahá na chybové/gating cesty a cross-module kontrakt
  (model→klíč) → před reportem pustit nezávislý self-review (čerstvý kontext).
