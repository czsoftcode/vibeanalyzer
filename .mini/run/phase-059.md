---
phase: 59
verdict: done
steps:
  - title: "Orchestrátor runChunkedMode v novém modulu"
    status: done
  - title: "Testy se zuby pro orchestrátor"
    status: done
  - title: "Zelený typecheck a testy"
    status: done
  - title: "Nezávislý self-review sub-agentem"
    status: done
---

# Phase 59 — report z auto session

## Co je hotové
Nový modul **`src/analyze/aiChunkedRun.ts`** s čistou funkcí pro krájený AI běh,
zatím BEZ napojení do cli (to je další fáze):

- **`runChunkedMode(chunks, runOne)`** → `ChunkedRunResult { status: AiStatus;
  chunkTotal; chunkFailed; failureReasons: string[] }`.
- Běží **sekvenčně**, stateless. `runOne` (spuštění režimu na jedné části) injektuje
  volající → orchestrátor sám nevolá API ani `run*Analysis`, je generický přes tři režimy.
- Slučování úspěšných částí: findings spojené v pořadí částí, usage = součet input+output,
  costUsd = součet, model z první analyzed.
- Provozně přeskočená část (`skipped`) se nezahodí → `chunkFailed` + `failureReasons`,
  běh pokračuje. ≥1 analyzed → `status` analyzed; 0 analyzed → `skipped` se souhrnným
  důvodem (`summarizeFailures`). Prázdné chunks → `skipped`, počty 0.
- **Programová chyba z `runOne` (throw) probublá se stackem** (await bez try/catch) –
  nemaskuje se jako přeskočení.

## Testy
Nový soubor `src/analyze/aiChunkedRun.test.ts` (10 testů) s reálnými tvary
`AiStatus`/`AiChunk`/`Finding`. Ne happy-path: součet usage + pořadí findings; runOne
dostává správný index sekvenčně; degradace při skipnuté části; model z první analyzed;
všechny skipped (stejný i různý důvod → souhrn); ready stav → rozejití chunkFailed vs
failureReasons; prázdné chunks; programová chyba → rethrow se stackem; přerušení smyčky
po chybě (další části se už nevolají).

Celá sada: **650 → 651 testů zelených** (59 souborů), typecheck čistý.

## Adversarial review (nezávislý sub-agent, čerstvý kontext)
Sub-agent projel kontrakt + mutační testování. Verdikt: implementace čistá, kontrakt
splněn (slučování, rethrow programové chyby, hranice analyzed/skipped, edge cases,
determinismus). Mutace (a) smazání slučování findings, (b) model z poslední místo první,
(c) spolknutí throw do try/catch – všechny testy chytají.

**Jediný reálný nález [STŘEDNÍ]: díra v testech** – mutace `chunkFailed = failureReasons.length`
procházela zeleně, protože žádný test neměl `ready`/`verified` část, kde se `chunkFailed`
(= total − analyzed) a `failureReasons.length` rozejdou. **Opraveno**: přidán test s `ready`
částí; ověřeno, že s mutací padá a po vrácení prochází (proto 651, ne 650).

Nízká (mimo opravu): nehlídaný drift modelu mezi částmi (model z první, usage/cena
pozdějších částí by se sečetly pod něj) – vědomě „nemá nastat" (volající používá jeden
model), neassertováno. Pozorování: podhodnocení ceny u max_tokens skipů – vědomě
odloženo (mini todo).

## Známá omezení (mimo tuto fázi)
- Orchestrátor je NENAPOJENÝ – `cli.ts` pořád volá `run*Analysis` jednorázově.
  Napojení (`runOne` jako obal nad `run*Analysis`, splitAiPayload se 75 % oknem,
  promítnutí `chunkFailed`/`failureReasons` do reportu) je další fáze.
- Cena provozně přeskočených (max_tokens) částí se do sloučené `costUsd` nezapočítá
  (skipped nenese usage strukturovaně) – v `mini todo`, řeší se při napojení.
