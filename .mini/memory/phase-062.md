# Phase 62 — Cena přeskočených částí strukturovaně

**Goal:** run*Analysis u provozně přeskočené části (max_tokens/prázdný výstup) vrátí usage+costUsd strukturovaně (rozšířená varianta skipped) a runChunkedMode je započítá do sloučené ceny krájeného běhu, i když výsledný stav skončí jako skipped.

## Steps
- [done] Rozšířit AiStatus.skipped o usage?/costUsd?
- [done] run*Analysis: provozní skip nese cenu strukturovaně
- [done] runChunkedMode: započítat cenu i ze skipped částí
- [done] Bump INDEX_VERSION 18 → 19
- [done] Zelený typecheck + testy + self-review sub-agentem

## Auto-commit
- Phase 62: Cena přeskočených částí strukturovaně

## Discussion
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

## Run report
---
phase: 62
verdict: done
steps:
  - title: "Rozšířit AiStatus.skipped o usage?/costUsd?"
    status: done
  - title: "run*Analysis: provozní skip nese cenu strukturovaně"
    status: done
  - title: "runChunkedMode: započítat cenu i ze skipped částí"
    status: done
  - title: "Bump INDEX_VERSION 18 → 19"
    status: done
  - title: "Zelený typecheck + testy + self-review sub-agentem"
    status: done
---

# Phase 62 — report z auto session

## Co se udělalo
Provozně přeskočená AI část (model utnul výstup na `stop_reason=max_tokens` nebo vrátil
prázdno – API už proběhlo a naúčtovalo tokeny) teď nese cenu i **strukturovaně**, ne jen
v textu `reason`. Orchestrátor krájeného běhu (`runChunkedMode`) ji sečte do sloučené
`costUsd`, takže krájený běh cenu nepodstřeluje.

- `aiStatus.ts`: varianta `skipped` rozšířena o nepovinné `usage?`/`costUsd?` (+ doc).
- `aiResult.ts`: ve všech 3 funkcích (`runAiAnalysis`/`runAiCodeAnalysis`/`runAiLogicAnalysis`)
  větev max_tokens/prázdný výstup vrací do skipped i `usage` a `costUsd` (cena se počítá
  týmž `computeCostUsd`, žádný duplikát čísla). Text reason zůstal.
- `aiChunkedRun.ts`: skipped větev přičítá usage/costUsd, když je nese; do TÝCHŽ
  akumulátorů → správně se promítne do sloučeného `analyzed` (míchaný běh) i do výsledného
  `skipped` (všechny části utnuté). Flag `skippedCost` rozliší, jestli výsledný skipped má
  pole nést, nebo je nechat `undefined` (beznákladové skipy).
- `jsonIndex.ts`: bump `INDEX_VERSION` 18 → 19 + historie v doc komentáři.

## Testy (mají zuby)
- `aiResult.test.ts`: u všech 3 funkcí max_tokens/prázdný výstup ověřuje `usage` i
  `costUsd === computeCostUsd(usage, model)`; beznákladové skipy (žádné non-goaly, síťová
  chyba) ověřují `usage`/`costUsd` = undefined.
- `aiChunkedRun.test.ts`: nový helper `skippedWithCost`; testy přes REÁLNÝ `runChunkedMode`:
  (a) míchaný analyzed + skipped-s-cenou → sloučená cena = součet obou; (b) všechny
  skipped-s-cenou → výsledný skipped nese nasčítanou cenu; (c) míchané skipy (nákladový +
  beznákladový) → jede jen cena nákladové.
- `jsonIndex.test.ts`: verze 19 + průchod skipped s usage/costUsd 1:1.
- Ověřeno mutací: vyříznutí akumulace skipnuté ceny v orchestrátoru shodí 3 testy.

Typecheck zelený, celá suite **649 testů zelených**.

## Self-review (nezávislý sub-agent, čerstvý kontext)
Potvrdil čistou sčítací logiku: žádný double-count (každá část je v jedné větvi přes
`else if`), správné rozlišení „nestálo nic" vs „$0" (prošel všechny skipped návraty),
testy mají zuby. Našel:
- **P2 (render, mimo rozsah fáze):** strukturovaná cena se uživateli nikde nezobrazí –
  markdown i stderr u skipnutého běhu ukazují jen text reason. Pro „všechny části utnuté"
  je v markdownu cena z jednoho (deduplikovaného) reasonu, kdežto správný součet leží
  jen v JSON. → přesunuto do `verify` jako kandidát na follow-up fázi. Bylo vědomě
  odloženo už v diskusi (fáze míří na accounting v datech, ne render).
- **P3 (vyřešeno):** chyběl test průchodu skipped-s-cenou v jsonIndex → doplněn.

## Rozhodnutí k zaznamenání
Žádná zásadní křižovatka navíc oproti diskusi (tvar = rozšířit skipped, sloučený skipped
nese cenu, bump 19) – ADR netřeba. Otevřená věc je jen render (P2) – to je spíš nová fáze
než decision.
