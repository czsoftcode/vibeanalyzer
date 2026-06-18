---
phase: 9
verdict: done
steps:
  - title: "validateAnswerLine – precondice na jeden řádek"
    status: done
  - title: "collectIntentDraft – sběrová smyčka přes injektovaný ask"
    status: done
  - title: "Kontraktní round-trip se renderem a parserem"
    status: done
  - title: "Testy se zuby – unhappy path sběru"
    status: done
  - title: "Adversariální self-review nezávislým sub-agentem + finální kontrola"
    status: done
---

# Phase 9 — report z auto session

## Co vzniklo
- **`src/intentPrompt.ts`** (nový):
  - `validateAnswerLine(raw)` – čistá precondice na JEDNU odpověď. Odmítne víceřádkový vstup (`\n`/`\r`), code-fence (` ``` `/`~~~`) a nadpis `## …`. Vrací `{ok, value}` / `{ok:false, reason}`.
  - `collectIntentDraft(ask)` – sběrová smyčka přes injektovaný `AskFn`; vrací `IntentDraft` (reuse z intentWriter) nebo `cancelled`. Povinný „co stavím" (1 řádek), pak 0+ non-goalů do prázdného řádku; nevalidní odpověď → re-ask s hláškou; EOF kdekoliv → cancel; prázdný building → cancel.
- **`src/intentPrompt.test.ts`** (nový): 15 testů (4 validace + 11 sběr).

## Ověřeno mechanicky (sám)
- `npm run typecheck` čistý, `npm test` **134/134**.
- **Round-trip má zuby**: `collectIntentDraft → renderProjectMd → parseIntent` přes REÁLNÝ parser vrátí přesně posbíraná data.
- **Unhappy path**: EOF na buildingu i uprostřed non-goalů → `cancelled` bez výjimky; prázdný building → `cancelled`; nevalidní řádek (fence/`##`/víceřádek) → re-ask, po opravě projde; víc nevalidních pokusů za sebou; žádné non-goaly → prázdný seznam.

## Adversariální review (nezávislý sub-agent) — našel a OPRAVENO
Sub-agent našel reálný **blocker**: původní `validateAnswerLine` kontrolovala `## ` jen kotvou `^` a nehlídala vnitřní `\n`. Protože kontrakt `AskFn` jednořádkovost negarantuje (paste/bracketed-paste), vstup `"text\n## Non-goals\nFAKE"` validací prošel, ale po renderu spolkl sekci Non-goals (víceřádková S2) — přesně třída, kterou měla fáze zavřít. Můj komentář navíc tvrdil, že víceřádek se „strukturálně nedostane", což platilo jen za nevyřčeného předpokladu.

**Oprava**: `validateAnswerLine` teď odmítá jakoukoli odpověď s vnitřním `\n`/`\r` — invariant „odpověď = jeden řádek" je vynucený, ne předpokládaný. Zavírá S1 i víceřádkové S2 najednou. Přidány 2 testy (validace víceřádku + round-trip se re-askem), které bez opravy padají. Zbytek fáze sub-agent potvrdil jako solidní (regexy přísnější než parser → bez false-negativů; smyčka se nezacyklí, EOF/prázdný řádek vždy dosažitelné; čisté oddělení od stdin/process; `IntentDraft` reuse, ne duplikát).

## Pro příští fázi (napojení do CLI)
Zbývá: reálné `ask` nad `readline`, TTY gate (v non-TTY se neptat — nehang), napojení do `run()` při chybějícím záměru (nahradit dnešní „Tip" nabídkou), a po sběru `renderProjectMd` + `writeIntentFile`. POZOR: integrační test musí ohlídat hranici, kterou tahle fáze nepokrývá — že reálné `ask` vrací `null` na EOF a strip­uje řádkový terminátor (CRLF na Windows).

## Drobné rozhodnutí (volitelný ADR)
EOF (`ask→null`) uprostřed sběru non-goalů zahodí i už posbírané a vrátí `cancelled` (odlišeno od prázdného řádku = „hotovo"). Alternativa „dokončit s tím, co je" byla zamítnuta (half-domyšlený záměr radši nepíšeme). Je to v docstringu; pokud to chceš podržet formálně, lze před `/mini:done` spustit `/mini:decision`. Spíš drobnost než plnohodnotný crossroads.
