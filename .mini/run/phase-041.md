---
phase: 41
verdict: done
steps:
  - title: "Modul detekce klíče: AiStatus union"
    status: done
  - title: "Zapojit detekci do cli.ts"
    status: done
  - title: "JSON index: pole ai + bump verze"
    status: done
  - title: "Markdown: AI sekce + souhrnný řádek"
    status: done
  - title: "Doběh: tsc + suite + reálný běh bez klíče"
    status: done
---

# Phase 41 — report z auto session

## Co je hotové
Přidaná „AI vrstva" jako pouhá brána klíče (reálné volání API ZATÍM ne – přijde ve fázi 5b).

- **`src/analyze/aiStatus.ts`** (nový): čistá `detectAiStatus(env)` → `{ kind: "skipped"; reason } | { kind: "ready" }`. Klíč chybějící / prázdný / jen whitespace → `skipped` s důvodem `chybí ANTHROPIC_API_KEY`. Sdílené konstanty `AI_KEY_ENV`, `AI_MISSING_KEY_REASON`. Funkce nikdy nevrací hodnotu klíče.
- **`src/report/jsonIndex.ts`**: nové povinné pole `ai`, bump `INDEX_VERSION` 10 → 11.
- **`src/report/markdown.ts`**: `aiSection` + `aiSummaryLine`, sekce „## AI analýza (logika a non-goaly)". Skip → `AI přeskočeno: <důvod>`, ready → `AI připraveno (klíč nalezen, dotaz zatím neproběhl)`.
- **`src/cli.ts`**: `const ai = detectAiStatus(process.env)` (bez try/catch – čistá funkce nepadá), předáno do `buildJsonIndex` i `buildMarkdown`.

## Ověření (mechanicky, sám)
- `npm run typecheck` čistý; `vitest run` = 50 souborů / 407 testů zelených (+2 nové e2e).
- Reálný běh CLI **bez klíče**: `.md` obsahuje `AI přeskočeno: chybí ANTHROPIC_API_KEY`, JSON `version: 11`, `ai: {"kind":"skipped",...}`.
- Reálný běh CLI **s klíčem**: `.md` „připraveno", `ai: {"kind":"ready"}`, hodnota klíče se do JSON ani .md NEdostala.

## Co našel a co opravil adversarial self-review (nezávislý sub-agent, čerstvý kontext)
Sub-agent našel jednu **self-catchable mezeru**: žádný e2e test neověřoval, že reálný běh `cli.ts` skutečně zapojí `ai` do JSON. Mutace `detectAiStatus(process.env) → detectAiStatus({})` původně prošla celou suitou (AI vrstva by v provozu vždy hlásila „přeskočeno" a nikdo by to nechytl). Opraveno:

- Nový **`src/cli.ai.test.ts`**: e2e test s řízeným `process.env` (`vi.stubEnv`), čte reálný JSON i .md pro obě větve. Ověřeno, že má zuby – po mutaci `cli.ts` test padá, po revertu prochází.
- `cli.moduleGraph.test.ts` a `jsonIndex.test.ts` (ř. 38): verze JSON už není natvrdo `10`/`11`, ale importovaný `INDEX_VERSION` (kontrakt na jednom místě).

**Nález 2 (injektovat env přes RunDeps) jsem vědomě NEpřijal** – CLAUDE.md zakazuje abstrakce „pro budoucnost"; `vi.stubEnv` + `vi.unstubAllEnvs()` v `afterEach` řeší determinismus testu bez nové injekční vrstvy. To je trade-off: AI vrstva tím zůstává jako jediná, která čte env přímo (ne jako injektovaná závislost). Pokud by se ve fázi 5b/5c env řídil z víc míst, stojí za to to přehodnotit.

## Na co dát pozor dál
- `ready` znamená POUZE „klíč existuje v env", NE „API odpovědělo". Ve fázi 5b (reálný dotaz) tenhle stav nezaměňovat za „ověřeno" – proto schválně ne „verified".
- Bump JSON na verzi 11 je rozbíjející změna tvaru pro konzumenty strojového indexu.
