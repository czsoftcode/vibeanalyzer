---
phase: 52
verdict: done
steps:
  - title: "Pole truncated do AiReport"
    status: done
  - title: "Propojit payload.truncated v cli.ts"
    status: done
  - title: "Sdílená poznámka v .md reportu"
    status: done
  - title: "Bump INDEX_VERSION 16 -> 17 + docs"
    status: done
  - title: "Testy se zuby"
    status: done
  - title: "Nezavisly self-review + zelena sada"
    status: done
---

# Phase 52 — report z auto session

## ROZŠÍŘENÍ (po self-review, na žádost uživatele)
Boolean „něco se uřízlo" byl uživateli málo — chtěl vědět O KOLIK přišel. Proto se
`AiReport.truncated?: boolean` nahradilo strukturou `truncation?: TruncationInfo`
(`{ includedFiles, omittedFiles, omittedBytes }`). Protože fáze 52 nebyla zacommitnutá,
JSON kontrakt se mění jen jednou (zůstává v17).
- **`aiPayload.ts`** — `collectAiPayload` nově počítá `omittedFiles` (počet souborů, co
  se nevešly nad celkový strop) a `omittedBytes` (jejich velikost z `FileEntry.size`,
  bez čtení uříznutých souborů). Vynechané = `selected.slice(includedFiles.length)`
  (included je vždy prefix selected).
- **`aiStatus.ts`** — nové sdílené `formatBytes()` (B/kB/MB) a `describeTruncation()`
  (jedna česká věta „AI viděla X z Y zdrojových souborů; ~Z kB kódu … se nevešlo"),
  kterou čte report i stderr → znění se nemůže rozejít.
- **`cli.ts`/`markdown.ts`** — staví/renderují `truncation` přes sdílenou větu.
- **Poctivost metriky:** počet souborů je exaktní; bajty jsou jen řádová míra (bajty ≠
  znaky u UTF-8), proto „~". Tokeny vědomě nevykazuju (odhad na druhou, budí falešnou
  přesnost). To je vše v doc komentářích.
- Testy rozšířeny: `aiStatus.test.ts` (formatBytes hranice + describeTruncation),
  `aiPayload.test.ts` (omittedFiles/omittedBytes vč. nulové cesty), JSON i cli wiring
  ověřují `truncation` s počty (invariant included+omitted = celkový počet kandidátů).

## INCIDENT při self-review (vyřešeno)
Druhý self-review sub-agent při mutačním ověřování zubů editoval PRODUKČNÍ soubory a
„obnovil" je do ŠPATNÉHO stavu — vrátil moje změny v `aiStatus.ts` a `aiPayload.ts`
úplně (cli/markdown/jsonIndex zůstaly OK). Zachyceno přes systémové upozornění o změně
souboru, obě změny ručně znovu aplikovány, plná sada znovu zelená (603 testů). Poučení:
příště dát recenzentovi výslovný zákaz editace + běh v odděleném worktree.

## Co bylo cílem
Příznak `payload.truncated` (collectAiPayload uřízl kód nad celkovým stropem
`AI_PAYLOAD_CHAR_BUDGET` = 1,65M znaků) se dosud promítal jen do promptu pro model
a do stderr hlášky — do .md/JSON reportu NE. Kdo četl jen report, nepoznal, že AI
posuzovala neúplný projekt. Fáze to napravuje stejnou cestou jako už existující
`oversizedFiles`.

## Co se udělalo
- **`src/analyze/aiStatus.ts`** — do interface `AiReport` přidáno nepovinné
  `truncated?: boolean` (vedle `oversizedFiles?`), s doc komentářem (payload-metadata
  sdílená všemi režimy; plní se jen když se reálně stavěl payload).
- **`src/cli.ts`** — `truncated: payload.truncated` se vrací ze DVOU větví, kde se
  payload reálně staví: běhová (ř. 626) i cenová skip-brána (ř. 599). Větve bez
  payloadu (`--ai-check`, pre-skip bez klíče, pouhá detekce klíče) pole vynechávají.
- **`src/report/markdown.ts`** — nová `aiTruncatedNote(truncated)` (blockquote, jen
  když `truncated === true`), zařazená v `aiSection` PŘED `aiOversizedNote`.
- **`src/report/jsonIndex.ts`** — `INDEX_VERSION` bump 16 → 17 + doc komentáře
  (změna tvaru = kontrakt s konzumenty JSON). `AiReport` se serializuje přímo,
  takže `ai.truncated` propadne do JSON sám.
- **Testy** — markdown (truncated=true → poznámka; false/undefined → nic; kombinace
  s oversizedFiles → obě poznámky ve správném pořadí), JSON (verze 17 proti reálné
  konstantě; truncated 1:1; undefined když chybí), cli wiring (velký projekt reálně
  přeteče strop → JSON nese `ai.truncated=true` v běhové i v cenové skip-větvi).

## Stav ověření
- **Plná sada zelená:** 597 testů (po doplnění kombinovaného testu 598). Spuštěno
  `npx vitest run`.
- **Self-review** nezávislým sub-agentem (čerstvý kontext) — mutačně ověřil zuby:
  smazání `truncated` z kterékoli větve cli.ts shodí příslušný test, vyřazení
  `aiTruncatedNote` shodí markdown test. Žádný blocker/major/minor; dva nity, jeden
  (kombinovaný test truncated+oversized) jsem na místě doplnil, druhý (drobná
  redundance helperů `readAi`/`readAiRaw` v testu) jsem nechal — kosmetika bez dopadu.

## Na co upozornit (předexistující, NEsouvisí s touto fází)
- **`npm run typecheck` je červený (exit 2, 45 chyb TS2532).** Je to plně ten
  předexistující flood z **todo 18** — všech 45 chyb je v testových souborech
  `aiResult.test.ts` (34), `cli.ai.test.ts` (9), `aiPayload.test.ts` (2). V ŽÁDNÉM
  mnou měněném souboru typecheck nehlásí nic. Tato fáze flood nezvětšila. Brána
  typecheck tím ale dál maskuje budoucí reálné regrese — stojí za samostatnou
  úklidovou fázi (todo 18).

## Konzistence stderr ↔ report (kontrolovaný bod)
Stderr „(viz report)" v `runOneAiMode` se vypíše jen u `analyzed` + `truncated`, a
report poznámku v té situaci vždy má, protože stderr i report čtou TÉŽE hodnotu
`payload.truncated`. Rozejít se nemohou. Navíc report poznámku přizná i u cenového
skipu (kde stderr nepadne) — to je žádoucí, ne nekonzistence.
