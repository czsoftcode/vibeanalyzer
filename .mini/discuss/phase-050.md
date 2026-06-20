# Phase 50 — glm: vyšší strop výstupu a thinking

## Intent
Pro model `glm` (Z.ai Anthropic-kompatibilní endpoint) odstranit uříznutí AI výstupu.
Empiricky: `--ai-logic --ai-model=glm` na reálném projektu DOBĚHLO, ale vrátilo
`stop_reason=max_tokens` (přeskočeno, žádná chyba od API). Příčina je teď z docs Z.ai
jasná a doložená (https://docs.z.ai/guides/overview/concept-param):
- glm jede defaultně `reasoning_effort: "max"` → přemýšlí naplno → sežral strop.
- náš kód navíc posílá `max_tokens: 16000`, čímž glm STAHUJE POD jeho vlastní default
  (default 65536) → na JSON nezbylo místo.
- `thinking: { type: "adaptive" }` Z.ai nezná (zná jen enabled/disabled) → tiše spadl
  na default (enabled + effort max). Sedí na pozorování.

Cíl: per-model konfig jen pro glm — `max_tokens` 64k + NÍZKÝ `reasoning_effort`.
opus/sonnet beze změny (adaptive, 16k).

## Key decisions (potvrzeno z docs Z.ai)
- **Per-model hodnoty rozšiřují `AI_PROVIDERS`** (aiStatus.ts:29) — jediný zdroj pravdy
  per model. Přidat per-model konfig požadavku, ne globální konstantu sdílenou všem.
- **glm:**
  - `max_tokens: 65536` (= 64k). Docs: glm-5.2 max output 131072, default 65536 → 64k OK.
  - `thinking: { type: "enabled" }` (NE adaptive; thinking NEMÁ budget_tokens).
  - `reasoning_effort: "low"` (popř. "minimal") — DEFAULT je "max", to je kořen problému.
    Povolené: max|xhigh|high|medium|low|minimal|none. Funguje jen s thinking.type=enabled.
- **opus/sonnet:** beze změny — `max_tokens: 16000`, `thinking: { type: "adaptive" }`,
  ŽÁDNÝ `reasoning_effort` (Anthropic ho nezná, neposílat).
- `realAiAnalyze` čte tvar požadavku (max_tokens, thinking, příp. reasoning_effort)
  z `AI_PROVIDERS[model]`, ne z globální konstanty.

## Watch out for
- **`reasoning_effort` je rozšíření Z.ai, NE standardní Anthropic parametr.** Anthropic
  TS SDK ho v typu `messages.stream()` nezná → propašovat jako extra pole (cast / extra
  body param). Musí jít POUZE pro glm; opus/sonnet ho NESMÍ dostat (Anthropic by mohl
  odmítnout). Tj. thinking i reasoning_effort jsou opravdu per-model, ne plošné.
- **Dvě páky naráz (effort=low + 64k strop).** Z docs je hlavní páka `reasoning_effort`
  (kořen), 64k je pojistka. Po opravě nepoznáš, která co spravila — akceptováno,
  zmínit v reportu fáze.
- **Unit testy: jen TVAR požadavku přes SDK mock.** Že glm reálně nepadne na max_tokens
  prokáže až placený reálný běh. Test MUSÍ ověřit per-model rozlišení:
  - glm → max_tokens 65536 + thinking {type:"enabled"} + reasoning_effort "low";
  - opus/sonnet → max_tokens 16000 + thinking {type:"adaptive"} + ŽÁDNÝ reasoning_effort.
- **Existující test aiAnalyze.test.ts:60** tvrdě čeká `thinking === {type:"adaptive"}` a
  `max_tokens === AI_ANALYZE_MAX_TOKENS` pro opus. Rozšířit na per-model, nepřepsat do
  bezzubého stavu (nesmí přestat hlídat, že glm dostane jiné hodnoty než opus).
- **Odhad nákladů před AI během** (project.md): pokud čerpá z max_tokens, glm 64k
  zečtyřnásobí worst-case odhad. Najít, kde se počítá, a sjednotit s per-model maxTokens.
- **Konstanta `AI_ANALYZE_MAX_TOKENS`** je dnes exportovaná a importovaná testem. Při
  přesunu do AI_PROVIDERS rozhodnout: alias/default vs. odstranit + opravit importy.
  Nenechat mrtvý/matoucí literál.
