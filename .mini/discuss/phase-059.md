# Phase 59 — Orchestrátor slučování běhu částí

## Intent
Stavební blok pro krájené AI běhy. Dnes `cli.ts` volá `run*Analysis` JEDNOU nad
celým payloadem; po napojení děliče (další fáze) poběží AI vrstva přes N částí
(`splitAiPayload`). Orchestrátor je čistá funkce, která daný režim spustí přes
všechny části (stateless – části na sobě nezávislé) a sloučí výsledky do jednoho.

Tato fáze = jen orchestrátor + testy se zuby. ŽÁDNÉ napojení do cli, žádné volání
API ani `run*Analysis` (ty předá volající přes `runOne`). Dočasně nenapojený kód –
obhajitelné, hned navazuje napojovací fáze.

## Key decisions
- **Signatura:** orchestrátor dostane `chunks: AiChunk[]` a `runOne: (chunk, index) => Promise<AiStatus>`
  (spuštění JEDNOHO režimu na JEDNÉ části). Sám nezná `run*Analysis` → generický přes
  všechny tři režimy a testovatelný s fake `runOne`.
- **Běh SEKVENČNĚ** (jedna část po druhé), ne paralelně. Důvod: jednoduché,
  deterministické pořadí, žádný nával na API (rate-limit 429). Stateless návrh nebrání
  paralelizovat později; teď se to vědomě nedělá (nepřidávat složitost pro budoucnost).
- **Bohatší návratový typ vedle AiStatus** (ne cpát metadata do AiStatus, který sdílí
  i nekrájené cesty). Návrh tvaru (doladit v plan):
  `{ status: AiStatus; chunkTotal: number; chunkFailed: number; failureReasons: string[] }`.
- **Slučování úspěšných (analyzed) částí:** findings = SPOJENÍ v pořadí částí
  (deterministické); usage = součet `inputTokens`+`outputTokens`; costUsd = součet
  `costUsd` analyzed částí; model = z první analyzed (všechny části běží na stejném modelu).
- **Stav výsledku:** ≥1 část analyzed → `status` = `analyzed` (posbírané findings +
  sečtená usage/cost). 0 analyzed (všechny skipped) → `status` = `skipped` se souhrnným
  reason (z `failureReasons`).
- **„Selhání části" = PROVOZNÍ chyba** (529/timeout/max_tokens) → `runOne` vrátí
  `skipped`; orchestrátor ji počítá do `chunkFailed` + `failureReasons` a posbírá zbytek.
  **Programová chyba** (`runOne` vyhodí, classify ji neznal) → orchestrátor ji NEMASKUJE,
  nechá probublat se stackem (rethrow). Princip z CLAUDE.md.
- **Prázdné chunks** (`length === 0`) → `status` = `skipped("žádné zdrojové soubory
  k analýze")`, `chunkTotal=0`, `chunkFailed=0`. Konzistentní s dnešním `run*Analysis`.

## Watch out for
- **Cena přeskočené (max_tokens) části se NEzapočítá** do sloučené `costUsd` → mírné
  PODHODNOCENÍ. Vědomě ODLOŽENO (orchestrátor jen slučuje, co dostane; skipped nenese
  usage/cost strukturovaně, jen v textu reason). Zapsáno do `mini todo` (strukturovaná
  cena u skipů) – řešit v napojovací fázi. Cena zůstává vidět v textu důvodu.
- **Cross-module kontrakt:** orchestrátor čte `AiStatus` (`kind: analyzed` nese
  model/findings/usage/costUsd; `skipped` nese reason) z `aiStatus.ts` a `AiChunk`
  z `aiPayload.ts`. Test musí pracovat s REÁLNÝMI tvary, ne s vymyšleným literálem.
- **Neočekávané stavy z runOne:** v analytickém běhu vrací `runOne` jen `analyzed`
  nebo `skipped`. Pro robustnost: cokoliv != `analyzed` se nezapočítá do findings;
  pokud nese reason → do `failureReasons`. (`ready`/`verified` by neměly nastat.)
- **Testy se zuby (ne happy-path):** víc částí → správný součet usage + spojené
  findings v pořadí; jedna část skipped → degradace (posbírá zbytek, `chunkFailed=1`,
  reason zachycen); VŠECHNY skipped → `status` skipped se souhrnem; prázdné chunks →
  skipped; `runOne` vyhodí → orchestrátor PROBUBLÁ (rethrow), neztratí stack ani
  neztichne; determinismus pořadí findings.
- **Determinismus:** pořadí findings = pořadí částí; sekvenční běh ho garantuje.
- **Kde typ/funkce žije** (`aiResult.ts` vs nový modul) – rozhodnout v plan.
