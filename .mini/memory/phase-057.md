# Phase 57 — classifyAiError: 529 a terminated

**Goal:** Rozšířit classifyAiError o čistou degradaci pro HTTP 529 (overloaded_error -> 'API přetížené, zkus později') a pro přerušené streamované spojení (TypeError: terminated -> síťová chyba), aniž by se obecná programová TypeError přestala probublávat se stackem; doplnit testy se zuby pro obě větve.

## Steps
- [done] Rozšířit classifyAiError o 5xx a terminated
- [done] Testy se zuby pro nové větve
- [done] Zelený typecheck a testy
- [done] Nezávislý self-review sub-agentem

## Auto-commit
- Phase 57: classifyAiError: 529 a terminated

## Discussion
# Phase 57 — classifyAiError: 529 a terminated

## Intent
Rozšířit `classifyAiError` (src/analyze/aiPing.ts:43) o dvě provozní chyby, které dnes
propadnou na `return null` a probublají jako „nečekaná chyba" se stackem:
1. **HTTP 529 (overloaded)** → čistý `skipped` „API přetížené, zkus později".
2. **`terminated`** (utnuté streamované spojení v `realAiAnalyze`) → čistý `skipped`
   „síťová chyba při dotazu na API".
Kontrakt je sdílený: `classify` používá ping cesta (cli.ts:648-657) i analytická cesta
(aiResult.ts:255-258 `if (reason === null) throw err; return { skipped, reason }`).
Jediná oprava classifyAiError tedy spraví oba režimy najednou.

## Key decisions
- **Rozsah 5xx (rozhodnuto uživatelem): 529 + 503 degradují, ostatní 5xx probublají.**
  - `status === 529` → „API přetížené, zkus později"
  - `status === 503` → „API je dočasně nedostupné, zkus později"
  - 500/502/jiné 5xx → `null` (probublat se stackem, můžou signalizovat reálný problém).
- **529/503 přicházejí jako `Anthropic.InternalServerError`** — SDK mapuje VŠECHNA 5xx na
  tuto jednu třídu (`node_modules/@anthropic-ai/sdk/core/error.js:63 if (status >= 500)`),
  status NENÍ zúžený typem. Proto match přes `err instanceof Anthropic.InternalServerError
  && (err.status === 529 || err.status === 503)`, ne přes typ.
- **`terminated` NENÍ holý TypeError.** SDK MessageStream (`lib/MessageStream.js:48-52`)
  zabalí každou ne-Anthropic chybu během streamu do ZÁKLADNÍ `Anthropic.AnthropicError`:
  zkopíruje `message` (= "terminated") a nastaví `.cause` = původní `TypeError`. Detekce
  tedy stojí na `err instanceof Anthropic.AnthropicError` + match zprávy/cause na
  "terminated", NE na `instanceof TypeError`.

## Watch out for
- **Pořadí instanceof.** `AnthropicError` je předek VŠEHO (i `APIError`/`RateLimitError`/
  `InternalServerError`). Větev pro „terminated" musí být ÚZKÁ (match na message "terminated")
  a stát AŽ ZA specifickými větvemi (timeout/connection/auth/ratelimit/5xx), jinak by
  spolkla i 401/429/529.
- **Nezklasifikovat každý base AnthropicError jako síť.** Base `AnthropicError` se hází i
  pro legitimní protokolové chyby („stream ended without producing a Message",
  MessageStream.js:343/348), které CHCEME probublat. Proto výhradně match na "terminated".
- **String-match "terminated" je křehký** — undici-specifická zpráva, může se měnit mezi
  verzemi Node/undici. Typovaná cesta neexistuje. Robustnější varianta: kontrolovat i
  `err.cause instanceof TypeError && /terminated/i.test(err.cause.message)` jako fallback.
- **Stávající kontrakt zachovat:** holý `TypeError("boom")` → `null` (programová chyba dál
  probublá). Tenhle existující test (aiPing.test.ts:41) MUSÍ dál procházet.
- **Známá nepokrytá mezera:** 529 přišlé jako SSE error-event UPROSTŘED streamu
  (streaming.js:113 `new APIError(undefined, ...)`) má `status: undefined` → náš
  status===529 ho nechytne. Reálný nález z fáze 44 byl 529 při navázání spojení
  (= InternalServerError(529)), hlavní cestu pokrýváme; tento edge jen zmínit v reportu.

## Testy se zuby
- 529: `new Anthropic.InternalServerError(529, body, msg, headers, "overloaded_error")`
  → „API přetížené, zkus později".
- 503: `InternalServerError(503, ...)` → „API je dočasně nedostupné, zkus později".
- 500: `InternalServerError(500, ...)` → `null` (důkaz, že NEpřematchujeme všechna 5xx).
- terminated: replikovat SDK wrap — `const e = new Anthropic.AnthropicError("terminated");
  (e as any).cause = new TypeError("terminated");` → „síťová chyba při dotazu na API".
- regrese: holý `TypeError("boom")` → `null` zůstává.
- zub: dočasné rozbití kterékoli nové větve → odpovídající test padne.

## Run report
---
phase: 57
verdict: done
steps:
  - title: "Rozšířit classifyAiError o 5xx a terminated"
    status: done
  - title: "Testy se zuby pro nové větve"
    status: done
  - title: "Zelený typecheck a testy"
    status: done
  - title: "Nezávislý self-review sub-agentem"
    status: done
---

# Phase 57 — report z auto session

## Co se udělalo
Rozšířil jsem `classifyAiError` (src/analyze/aiPing.ts) o tři nové provozní stavy,
které dnes propadaly na `null` a probublávaly jako „nečekaná chyba" se stackem:

- **HTTP 529** (InternalServerError, status===529) → „API přetížené, zkus později"
- **HTTP 503** (InternalServerError, status===503) → „API je dočasně nedostupné, zkus později"
- **utnutý stream** (base `AnthropicError` s message/cause „terminated") → „síťová chyba při dotazu na API"

Ostatní 5xx (500/502…) a holé `TypeError` dál vrací `null` (probublají). Detekce
„terminated" je vytažená do helperu `isTerminatedStreamError` (kontroluje `message`
i `cause` jako robustnější fallback).

Oprava je v jednom bodě, který je SDÍLENÝ ping cestou (cli.ts) i analytickou cestou
(aiResult.ts) — spravuje tedy oba režimy najednou bez dalších zásahů.

## Klíčová zjištění (potvrzená ze zdrojů SDK)
- SDK mapuje VŠECHNA 5xx na jednu třídu `InternalServerError` (core/error.js:63
  `if (status >= 500)`), status není zúžený typem → kontroluji ho ručně, jinak by se
  529-větev spustila i na 500.
- „terminated" NENÍ holý `TypeError` — MessageStream (lib/MessageStream.js:48-52)
  zabalí ne-Anthropic chybu ze streamu do base `AnthropicError`, zkopíruje message
  a do `cause` dá původní `TypeError`. Detekce proto stojí na base `AnthropicError` +
  match na „terminated", NE na `instanceof TypeError` (ten je dál programová chyba → null).
- Pořadí `instanceof` je kritické: `AnthropicError` je předek úplně všeho, proto je
  větev „terminated" poslední a zúžená na message/cause — jinak by spolkla 401/429/5xx
  i legitimní protokolové chyby base `AnthropicError`.

## Testy
14 testů v aiPing.test.ts (přibylo 6 nových): 529, 503, 500→null, terminated přes
message, terminated přes cause (fallback), base AnthropicError bez terminated→null.
Testují reálný kód a reálné SDK třídy (Object.create na prototypu / reálný konstruktor),
ne mock. Ověřen zub: dočasné rozbití větve 529 shodilo přesně odpovídající test, ostatní
zůstaly zelené. Plný běh: `npx tsc --noEmit` čistý, `npx vitest run` 624/624 zelené.

## Self-review (nezávislý sub-agent, čerstvý kontext)
Bez kritických a středních nálezů. Potvrdil dosažitelnost obou nových cest ze zdrojů
SDK (529/503 přijdou jako InternalServerError; maxRetries:0 zabrání retry 5xx;
terminated přijde jako wrapped AnthropicError), správné pořadí instanceof a zuby testů.

Dvě drobnosti (ani jedna nevyžaduje změnu kódu):
1. String-match „terminated" je undici-specifický. Failure mode je BEZPEČNÝ: při změně
   zprávy v jiné verzi undici nastane false-negative → chyba propadne na null → probublá
   (žádný tichý falešný úspěch). False-positive je nepravděpodobný (SDK pro protokolové
   chyby slovo „terminated" nepoužívá). Křehkost je v kódu poctivě okomentovaná.
2. Formulace „null → probublá se stackem" je v praxi měkčí: všichni volající
   (runOneAiMode, --ai-check) throw zachytí, vypíšou stack na stderr a degradují na
   skipped s exit 0. To je vědomá projektová volba (viditelnost bez pádu), ne regrese
   této fáze. Pro classifyAiError se nic nemění (null = ukaž stack místo tichého skip).

## Známá nepokrytá mezera (vědomý kompromis)
529 přišlé jako SSE error-event UPROSTŘED streamu (streaming.js:113
`new APIError(undefined, ...)`) má `status: undefined` → náš `status===529` ho
nechytne a propadne na null (probublá). Reálný nález z fáze 44 byl ale 529 při navázání
spojení (= InternalServerError(529)), takže hlavní cestu pokrýváme. Pokrytí mid-stream
SSE 529 by vyžadovalo match přes `err.type === "overloaded_error"`, což je na samostatnou
fázi, pokud se v praxi ukáže.
