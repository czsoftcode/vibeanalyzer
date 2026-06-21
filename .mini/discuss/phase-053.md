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
