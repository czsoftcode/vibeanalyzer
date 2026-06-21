# Phase 60 — Napojit krájený AI běh do CLI

**Goal:** V cli.ts spustit AI vrstvu přes části (splitAiPayload s oknem plněným na 75 %) a runChunkedMode per režim místo jednorázového run*Analysis, sloučit do AiReport a přepočítat odhad ceny na N částí (výstup škáluje s počtem částí, gate se ptá na reálné N); report truncation logika nesmí padat. Přiznání rozdělení v reportu (počet částí, chunkFailed/failureReasons, cross-chunk slepota) řeší navazující fáze.

## Steps
- [done] run*Analysis a build*Prompt na AiChunk
- [done] estimateAiCost a odhad pro N částí
- [done] Napojit splitAiPayload + runChunkedMode v cli
- [done] Report: truncation pryč, info o krájení dovnitř
- [done] Smazat collectAiPayload + AiPayload
- [done] Zelený typecheck a testy se zuby pro krájený běh
- [done] Nezávislý self-review sub-agentem

## Auto-commit
- Phase 60: Napojit krájený AI běh do CLI

## Discussion
# Phase 60 — Napojit krájený AI běh do CLI

## Intent
Spojit dosud nenapojené bloky (dělič fáze 58, orchestrátor fáze 59) a poprvé spustit
krájený AI běh end-to-end z `cli.ts`. Velký projekt se teď zkrájí na části a proběhne
celý (místo dnešního single-shotu s uříznutím). Koncept „truncation" (uříznutý payload)
tím zaniká – nahrazuje ho krájení.

POZOR – ROZSAH: fáze je VELKÁ (~3–4 dny, ~12 souborů), protože uživatel zvolil dvě
rozšiřující varianty (smazat truncation/collectAiPayload TEĎ + chunkFailed/failureReasons
rovnou do reportu). Plan to musí rozbít na 6–7 kroků. Pokud bude moc, kandidát na odložení
do samostatné fáze = promítnutí chunkFailed/failureReasons do .md/JSON reportu.

## Key decisions
- **run*Analysis + build*Prompt: AiPayload → AiChunk.** Čtou z payloadu jen `text`,
  `includedFiles` (+ `truncated` pro varování v promptu). `AiChunk` = `{ text,
  includedFiles }`. Varovná větev `if (payload.truncated)` v `buildAnalyzePrompt`/
  `buildCodePrompt`/`buildLogicPrompt` VYPADNE (u krájení se neuřezává). Zásah do 3 run*
  + 3 build* funkcí + jejich testů.
- **75 % okno:** konstanta (návrh `CHUNK_FILL_RATIO = 0.75`), `splitAiPayload` dostane
  `Math.floor(AI_PAYLOAD_CHAR_BUDGET * 0.75)`. „Plnit na max 75 %" = horní mez z todo
  („50–75 %").
- **cli tok:** `splitAiPayload(files, readFile, okno)` JEDNOU → `ChunkedPayload`
  (`chunks` + `oversizedFiles`). Per VYŽÁDANÝ režim `runChunkedMode(chunks, runOne)`,
  kde `runOne = (chunk) => runAiAnalysis(env, intent, chunk, model, analyze, classify)`
  (resp. code/logic varianty). `ChunkedRunResult.status` → `AiReport.nonGoal/code/logic`.
  `oversizedFiles` z `ChunkedPayload` → `AiReport.oversizedFiles` (beze změny konceptu).
- **estimateAiCost na N částí:** signatura z `(payload: AiPayload, ...)` na části
  (návrh `(chunked: ChunkedPayload, model, modeCount)` – z nich `total` = součet
  `chunk.text.length` a `N` = `chunks.length`). Vstup/režim = `total` (stejné jako dnes).
  Výstup (`min`/`typical`/`max`) se násobí navíc `N` (každá část = samostatné volání,
  může vyčerpat výstupní strop). `formatCostEstimate` ať zmíní počet částí. + testy
  (`aiEstimate.test.ts`, `cli.aicost.test.ts`).
- **SMAZAT (uživatel zvolil teď, ne odložit):**
  - `collectAiPayload` + interface `AiPayload` (aiPayload.ts) + jeho testy
    (`aiPayload.test.ts` část, `cli.aicost.test.ts`). `PayloadFile` ZŮSTÁVÁ (používá
    `AiChunk`). `selectAiCandidates`/`splitAiPayload`/`AI_PAYLOAD_*` ZŮSTÁVAJÍ.
  - `TruncationInfo`, `describeTruncation`, `formatBytes` (aiStatus.ts) + testy
    (`aiStatus.test.ts`). `formatBytes` má konzumenta JEN v truncation → padá s ním.
  - `AiReport.truncation` pole; render truncation v `markdown.ts` a `jsonIndex.ts` + testy
    (`markdown.ai.test.ts`, `markdown.test.ts`, `markdown.moduleGraph.test.ts`,
    `jsonIndex.test.ts`).
- **chunkFailed/failureReasons ROVNOU do reportu:** rozšířit `AiReport` (návrh: per
  režim nebo globálně – doladit v plan; pozor, počty jsou PER REŽIM, protože každý režim
  běží přes části zvlášť). Render v `.md` i JSON: „rozděleno na N částí, X selhalo:
  <důvody>". To je i přiznání cross-chunk slepoty (report uvede, že krájený běh nevidí
  souvislosti napříč částmi).

## Watch out for
- **JSON index = BUMP VERZE.** Tvar `ai` se mění (truncation pryč, přibude info o krájení).
  Index má verzi (dnes 17) – zvednout a ověřit test `jsonIndex.test.ts`.
- **chunkFailed je PER REŽIM, ne globální.** Každý ze tří režimů běží `runChunkedMode`
  samostatně → tři nezávislé počty. AiReport to musí umět rozlišit (ne jeden globální).
- **Degradace:** `runChunkedMode` probublá PROGRAMOVOU chybu (throw); `runOneAiMode`
  v cli ji má chytat a degradovat na skipped (zachovat dnešní chování). Provozní selhání
  části je už uvnitř `runChunkedMode` (status skipped / chunkFailed).
- **Gate ceny:** `estimate.costTypicalUsd` po přepočtu na N částí může přelézt práh
  u projektů, co dnes neprolézaly → gate se zeptá. To je ZÁMĚR (reálná cena roste s N),
  ne regrese. Ověřit, že `--ai-yes` / neinteraktivní cesta pořád funguje.
- **Cena přeskočené (max_tokens) části se NEzapočítá** (známé z fáze 59, todo 13) –
  v této fázi se NEŘEŠÍ; cena krájeného běhu může být mírně podhodnocená. Nezamlčet.
- **buildLogicPrompt(context, payload)** bere `context: string` (povinný, ne null jako
  buildAnalyzePrompt) – při překlopení na AiChunk zachovat tenhle rozdíl signatur.
- **Testy se zuby:** krájený běh přes víc částí (mock analyze) → sloučené nálezy
  v reportu; jedna část selže → report přizná počet; prázdný projekt; odhad ceny pro N>1
  část; gate nad prahem se ptá; cli degraduje při programové chybě. Cross-module: testy
  ať jedou přes reálné `splitAiPayload`+`runChunkedMode`, ne mock literál.
- **Velikost fáze** – viz Intent. Plan ať zváží odložení report-renderu chunkFailed.

## Run report
---
phase: 60
verdict: done
steps:
  - title: "run*Analysis a build*Prompt na AiChunk"
    status: done
  - title: "estimateAiCost a odhad pro N částí"
    status: done
  - title: "Napojit splitAiPayload + runChunkedMode v cli"
    status: done
  - title: "Report: truncation pryč, info o krájení dovnitř"
    status: done
  - title: "Smazat collectAiPayload + AiPayload"
    status: done
  - title: "Zelený typecheck a testy se zuby pro krájený běh"
    status: done
  - title: "Nezávislý self-review sub-agentem"
    status: done
verify:
  - title: "Reálný krájený AI běh na velkém projektu (s API klíčem)"
    detail: "Vše ověřeno mechanicky (641 testů + typecheck) s injektovaným fake analyze. Skutečné chování proti živému Anthropic/Z.ai API na projektu, co se reálně rozkrájí na víc částí (sloučení nálezů, reálná cena, formát promptu částí), jsem nespustil – nemám klíč ani to není v testech. Doporučuju jednou ručně přejet `--ai-code` na velkém projektu a zkontrolovat .md report (poznámka o krájení, nálezy ze všech částí)."
---

# Phase 60 — report z auto session

## Co je hotové
Krájený AI běh je NAPOJENÝ do CLI. Velký projekt se teď zkrájí na části a proběhne celý
(místo dřívějšího single-shotu s uříznutím). Konec konceptu „truncation".

- **run*Analysis + build*Prompt** (`aiResult.ts`) překlopené z `AiPayload` na `AiChunk`
  (text+includedFiles); varování „kód uříznut" v promptech pryč; v `runAiLogicAnalysis`
  zmizela větev odmítající uříznutý kód (krájená část je v rámci sebe úplná).
- **estimateAiCost** (`aiEstimate.ts`) bere `ChunkedPayload`: vstup = součet částí (krájení
  vstup nezdvojuje), výstup × počet částí (každá = vlastní volání). `formatCostEstimate`
  zmíní počet částí. Nové pole `chunkCount`.
- **cli.ts**: `splitAiPayload(files, readFile, floor(AI_PAYLOAD_CHAR_BUDGET × 0.75))` JEDNOU,
  chunks sdílené mezi režimy; každý vyžádaný režim přes `runChunkedMode` (runOne = obal nad
  run*Analysis pro jednu část); sloučený status → `AiReport`, per-režim metadata →
  `AiReport.chunking`. `runOneAiMode` přepsán na `ChunkedRunResult` (degradace zachována:
  programová chyba se vypíše se stackem a degraduje na skipped). Nová konstanta
  `CHUNK_FILL_RATIO = 0.75` (todo 10).
- **Report**: `markdown.ts` – per-režim poznámka o krájení (`aiChunkingNote`) místo
  truncation; u >1 části přizná cross-chunk slepotu a počet selhaných částí. `jsonIndex.ts`
  – INDEX_VERSION 17 → 18 (`ai` nese `chunking` místo `truncation`).
- **Smazáno**: `collectAiPayload`, interface `AiPayload`, `TruncationInfo`,
  `describeTruncation`, `formatBytes` + jejich testy (`aiPayload.test.ts` celý).

## Testy
Celá sada **640 → 641 zelená** (58 souborů), typecheck čistý. Nové/upravené testy se zuby:
- `cli.aicost.test.ts`: krájený běh e2e (velký projekt → víc částí, analyze per část,
  ai.chunking v JSON), 1 část u malého projektu, **provozní selhání části → report přizná
  chunkFailed + důvod (exit 0)**, a **reálné užití 75% okna** (projekt mezi 75% a 100%
  okna → 2 části; mutace na plné okno test shodí – ověřeno).
- `aiEstimate.test.ts`: výstup škáluje počtem částí (ne vstup), součin režimů×částí,
  prázdné chunks → 0.
- `markdown.ai.test.ts`, `jsonIndex.test.ts`: chunking render + verze 18.

## Adversarial review (nezávislý sub-agent, čerstvý kontext)
Sub-agent projel tok dat, degradaci, gate, mazání, per-režim metadata + mutační testování.
Verdikt: jádro v pořádku (tok cli→split→runChunkedMode→AiReport, degradace chyb, gate ceny,
chunking per-režim, žádný mrtvý kód – reference jen v komentářích). Mutace (smazání
chunkFailed, smazání ×chunkCount, chunkingMeta→undefined) testy chytají.

Nálezy a oprava:
- **N1 [nízká–střední, testovací díra]**: žádný test nepřipínal počet částí na velikost vůči
  75% oknu → mutace „okno bez × CHUNK_FILL_RATIO" procházela zeleně (velký projekt dal 2
  části tak i tak). **Opraveno**: přidán e2e test s projektem ~1,35M znaků (mezi 75% a 100%
  okna); ověřeno, že s mutací padá a po vrácení prochází (proto 641, ne 640).
- **N2 [kosmetika]**: komentáře v `aiPayload.ts` odkazovaly na smazaný `collectAiPayload`.
  **Opraveno**.

## Známá omezení (mimo tuto fázi)
- Cena provozně přeskočené (max_tokens) části se NEzapočítá do sloučené ceny (skipped nenese
  usage strukturovaně) → mírné podhodnocení u krájeného běhu. V `mini todo` (strukturovaná
  cena u skipů), řeší se zvlášť.
- Cross-chunk kontext: části AI nevidí naráz → logika/non-goaly napříč moduly slabší. Report
  to přiznává; lepší řešení (strojová mapa ke každé části) je v `mini todo`.
- Drift modelu mezi částmi se nehlídá (model z první analyzed) – vědomé, „nemá nastat".
