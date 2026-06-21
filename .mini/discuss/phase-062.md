# Phase 62 — Cena přeskočených částí strukturovaně

## Intent
Provozně přeskočená AI část (model utne výstup `stop_reason=max_tokens`, nebo vrátí
prázdný `rawText`) dnes nese cenu jen v TEXTU `reason` ("naúčtováno ~$…"). Orchestrátor
slučování krájeného běhu (`runChunkedMode`, aiChunkedRun.ts) ten text nečte → nasčítaná
`costUsd` krájeného běhu je mírně PODSTŘELENÁ. Cíl: nést tu cenu i strukturovaně (číslem),
aby ji orchestrátor sečetl. Dotčené funkce: `runAiAnalysis`, `runAiCodeAnalysis`,
`runAiLogicAnalysis` (aiResult.ts) + orchestrátor + jejich testy.

## Key decisions
- **Tvar (potvrzeno): rozšířit variantu `skipped`** o nepovinné `usage?: AiUsage` a
  `costUsd?: number` (NE nová varianta). Vyplní se JEN u provozního přeskočení, co reálně
  něco stálo (větev max_tokens/prázdný výstup v run*Analysis). Cesty bez nákladu (chybí
  klíč, žádné non-goaly, žádné soubory, classify→reason u síťové chyby) je NEvyplní →
  zůstanou undefined. AiStatus: `{ kind: "skipped"; reason: string; usage?: AiUsage; costUsd?: number }`.
- **Sloučený `skipped` taky nese cenu (potvrzeno):** v `runChunkedMode`, když žádná část
  nevrátila `analyzed`, sečíst `usage`/`costUsd` z přeskočených částí, co je mají, a vrátit
  je ve výsledném `skipped`. Jinak by nejbolavější případ (všechny části utnuté limitem)
  zůstal bez ceny. Pozor i na MÍCHANÝ případ: část analyzed + část skipped-s-cenou →
  výsledný `analyzed.costUsd` musí zahrnout i cenu skipnutých částí (dnes orchestrátor
  sčítá cenu jen z `analyzed` větví — řádky 79-85; doplnit i pro `skipped` s `costUsd`).
- **Bump JSON indexu na 19 (potvrzeno):** přidání nepovinných polí na `skipped` je změna
  tvaru `AiReport` → podle konvence projektu (verze 16 = oversizedFiles) bumpnout
  INDEX_VERSION 18 → 19 a doplnit řádek historie v komentáři jsonIndex.ts.
- **Rozpor text vs. číslo (potvrzeno OK):** `summarizeFailures` dedupuje stejné `reason`
  texty → v textu se cena z více částí ukáže jen jednou, ale strukturovaná `costUsd` je
  nasčítaná správně. Vědomě přijato (text je hrubý, číslo přesné). NEpřepisovat
  summarizeFailures kvůli ceně.

## Watch out for
- **Double-count:** cena z `analyzed` větví se sčítá na řádcích 79-85; nová cena ze
  `skipped` se přidá ve větvi `else if (status.kind === "skipped")` (řádky 86-88). Ověřit,
  že se táž část nezapočítá dvakrát a že `analyzed` část (která nese cost ve `costUsd`)
  NEnese zároveň cenu i jako skipped.
- **Test se zuby přes REÁLNÝ kód (CLAUDE.md pravidlo 3/4):** přes REÁLNÝ `runChunkedMode`
  injektovat `runOne`, který vrátí mix `analyzed` + `skipped{costUsd}` → ověřit, že
  sloučená `costUsd` = součet OBOU. Druhý test: VŠECHNY části `skipped{costUsd}` → výsledný
  `skipped` nese nasčítanou cenu. Když započítání skipnuté ceny dočasně vyříznu, test musí
  spadnout. NE testovat mock literál místo reálné sčítací logiky.
- **run*Analysis test:** větev max_tokens/prázdný výstup u všech TŘÍ funkcí musí vrátit
  `skipped` s `usage` i `costUsd` (ne jen v textu). `costUsd` ať se počítá týmž
  `computeCostUsd(usage, model)` jako u analyzed (sdílený výpočet, ne duplikát čísla).
- **Žádná regrese na ne-nákladových skipech:** "chybí klíč", "žádné non-goaly", "žádné
  soubory", síťová chyba (classify→reason) NESMÍ začít nést `costUsd: 0` ani jinak — pole
  zůstanou undefined (rozlišení "nestálo nic" vs "stálo $0").
- **Report (markdown.ts):** render `skipped` dnes ukazuje jen text reason. NOVÁ strukturovaná
  cena se zatím v reportu zvlášť nerenderuje (cena je dál v textu reason) — vědomě mimo
  rozsah. Když by se přidávalo, je to extra; tato fáze míří na ACCOUNTING, ne render.
- **Self-review sub-agentem:** fáze sahá na chybovou/přeskakovací cestu a na kontrakt mezi
  moduly (AiStatus tvar sdílí aiResult + aiChunkedRun + jsonIndex + markdown) → před reportem
  nezávislý self-review (CLAUDE.md).
