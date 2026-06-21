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
