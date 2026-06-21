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
