---
phase: 42
verdict: done
steps:
  - title: "Přidat @anthropic-ai/sdk + modul reálného pingu"
    status: done
  - title: "Rozšířit AiStatus o verified + async verifyAiAccess (DI) + unit testy"
    status: done
  - title: "Přepínač --ai-check do args.ts + test"
    status: done
  - title: "Zapojit do cli.ts + stderr hláška o chybějícím klíči"
    status: done
  - title: "Report: verified v JSON (verze 12) i markdownu + testy"
    status: done
  - title: "Doběh: tsc + suite + reálné běhy + nezávislý sub-agent"
    status: done
---

# Phase 42 — report z auto session

## Co se udělalo
AI vrstva dostala reálné ověření za opt-in přepínačem `--ai-check`. Default běh se
nezměnil (jen detekce klíče, offline, zdarma).

- **`src/analyze/aiPing.ts`** (nový): `realAiPing` sestaví klienta `@anthropic-ai/sdk`
  s `maxRetries: 0` a `timeout: 10000` ms a pošle minimální dotaz na konstantu
  `claude-haiku-4-5` (levný model, natvrdo – non-goal zakazuje konfigurák).
  `classifyAiError` zatřídí chybu pingu: síť/timeout/401/rate → konkrétní důvod
  přeskočení, cokoliv jiného → `null` (= nečekaná/programová chyba, probublá).
- **`src/analyze/aiStatus.ts`**: `AiStatus` rozšířen o `verified`. Nová async
  `verifyAiAccess(env, ping, classify)` – detekci klíče nechává čisté synchronní
  `detectAiStatus`, klíč čte až tady a nikdy ho nevrací; ping/classify injektované
  (testy bez sítě, default běh nenahraje SDK).
- **`src/args.ts`**: nový `--ai-check` (pole `aiCheck`).
- **`src/cli.ts`**: za `--ai-check` dynamický `import("./analyze/aiPing.js")` (SDK se
  načte jen když je vyžádán) + `verifyAiAccess`. Nečekaná chyba se chytí na hranici
  CLI, vypíše se STACK na stderr a AI degraduje na `skipped` (report se vyrobí, exit 0).
  Když klíč chybí, na stderr jde hláška, jak ho nastavit (env / `node --env-file`,
  bez dotenv).
- **`src/report/jsonIndex.ts`**: `INDEX_VERSION` 11 → 12 (union `ai` má `verified`).
- **`src/report/markdown.ts`**: `aiSection`/`aiSummaryLine` větev pro `verified`.

## Ověření (mechanické, vše hotovo mnou)
- `tsc --noEmit` čistý; celá vitest suite **428 testů passed** (52 souborů).
- Unit testy: `verifyAiAccess` (chybějící klíč → ping se nevolá, resolve → verified,
  známá chyba → skipped, null → rethrow), `classifyAiError` nad REÁLNÝMI SDK chybovými
  třídami (pořadí instanceof timeout-před-connection otestováno), e2e v `cli.ai.test.ts`
  (verified s fake pingem; `--ai-check` bez klíče → skipped + stderr hláška + exit 0).
- Reálné běhy: (A) default bez klíče → `skipped`; (B) `--ai-check` bez klíče → `skipped`,
  hláška na stderr, exit 0, JSON verze 12; (C) `--ai-check` s DUMMY klíčem → reálné SDK
  volání proběhlo, dostalo 401, `classifyAiError` → „API odmítlo klíč", AI `skipped`,
  exit 0, klíč NEunikl do .md/.json/stderr.

## Adversarial self-review
Nezávislý sub-agent (čerstvý kontext) projel projektový checklist (exit kódy, rozsah
catch, zuby testů, cross-module kontrakt, únik klíče, unhappy path, dosažitelnost).
Žádný [VÁŽNÉ] nález. Jediný [DROBNÉ]: `realAiPing` (reálné SDK volání) neměl automatický
test → doplněn `aiPing.realping.test.ts` (mock SDK, ověří `model`/`max_tokens`/
`maxRetries:0`/`timeout` a že chybu z `create` neodchytává). Tím je tvar volání hlídaný
i bez sítě.

## Pozn. pro člověka
- `verified` = „API odpovědělo na ping", NE „logika/non-goaly ověřeny" – to je teprve
  fáze 6. Report to formuluje jako „testovací dotaz na API proběhl".
- Reálný happy-path s PLATNÝM klíčem (skutečné `verified` z živého API) jsem nemohl
  ověřit – nemám platný `ANTHROPIC_API_KEY`. Smoke s dummy klíčem ale prošel celou
  reálnou cestou až po 401, takže tvar volání i degradace fungují; chybí jen potvrzení
  úspěšné větve proti živému API.
