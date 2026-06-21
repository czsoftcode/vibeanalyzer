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
