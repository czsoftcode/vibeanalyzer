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
