# Phase 42 — AI vrstva: reálný dotaz na Anthropic

## Intent
Mezikrok před fází 6 (skutečná analytická AI). Přidat `@anthropic-ai/sdk` a možnost
poslat minimální testovací dotaz na API, abychom před fází 6 ověřili, že AI cesta
(klíč + síť + auth) reálně funguje. Plus dotáhnout todo 8: jasná hláška, jak nastavit
klíč, když chybí (env proměnná, žádný dotenv).

Dnešní stav (z fáze 41): `src/analyze/aiStatus.ts` má čistou synchronní `detectAiStatus(env)`
→ `ready` (klíč je) | `skipped` (chybí). Žádná síť. Zapojeno v `src/cli.ts:392`
(`const ai = detectAiStatus(process.env)`), promítá se do `report/jsonIndex.ts` (pole `ai`,
verze 11) a `report/markdown.ts` (`aiSection`, `aiSummaryLine`).

## Key decisions
- **Spouštění reálného dotazu je za přepínačem `--ai-check`.** Bez něj default běh dělá jen
  detekci klíče (`ready`/`skipped`) – zůstává zdarma a offline, drží princip „strojová
  vrstva běží i bez sítě/klíče". S `--ai-check` a přítomným klíčem se pošle reálný dotaz.
  (Odhad/potvrzení nákladů je teprve fáze 5c, proto teď neutrácet na každém běhu.)
- **Nový stav se jmenuje `verified`.** `AiStatus` union = `skipped{reason}` | `ready` |
  `verified`. Význam: `ready` = klíč existuje, dotaz neproběhl; `verified` = API reálně
  odpovědělo. Fáze 41 schválně nepoužila „verified" pro pouhou detekci klíče – tady sedí.
- **Detekci klíče nechat čistou a synchronní.** Reálný dotaz dát do SAMOSTATNÉ async funkce
  (např. `verifyAiAccess`), která: 1) zavolá `detectAiStatus`; když chybí klíč → vrátí ten
  `skipped`; 2) když `ready` → pošle ping; úspěch → `verified`, síť/timeout/401 → `skipped`
  s konkrétním důvodem.
- **Dependency injection kvůli testům.** Funkce dostane volání SDK jako parametr (jako
  `detectAiStatus` dostává `env`), aby testy předaly fake, co resolvuje/rejectuje. Testy
  nikdy nesmí sáhnout na síť.
- **Model:** `claude-haiku-4-5` natvrdo jako konstanta (nejlevnější; non-goal zakazuje
  konfiguráky). Minimální dotaz, malé `max_tokens`.
- **„Úspěch" = HTTP 200 s textovým blokem.** NEkontrolovat obsah odpovědi (string-match na
  „OK" je křehký – model může odpovědět cokoliv).
- **Todo 8 / chybějící klíč:** instrukce „jak klíč nastavit" jde na konzoli (stderr), NE do
  perzistovaného reportu (v reportu zůstává stručné `chybí ANTHROPIC_API_KEY`). Primární
  cesta je env proměnná `ANTHROPIC_API_KEY` (SDK ji čte sám) nebo `node --env-file`.
  NEPŘIDÁVAT dotenv (nástroj je sám secret scanner).

## Watch out for
- **Úzký catch (maskování chyb):** `APIConnectionError`/timeout/`AuthenticationError(401)`
  → `skipped` s důvodem. `TypeError`, špatný tvar odpovědi, programová chyba → probublat se
  stackem, NESPOLKNOUT jako „přeskočeno" (tichý falešný úspěch = opakovaný nález).
- **SDK retry je past na timeout:** default `maxRetries: 2` retry-uje i timeouty → reálné
  čekání `timeout × 3`. Pro ping nastavit `maxRetries: 0` a krátký timeout (~10 s; v TS SDK
  je timeout v MILISEKUNDÁCH). Síťový problém pak přeskočí rychle.
- **Exit kód:** selhání AI pingu (síť/timeout/chybný klíč) = legitimní `skipped`, NESMÍ
  shodit proces na nenulový kód – strojový report se stejně vyrobí. Zároveň to nesmí být
  tichý úspěch – zaznamená se jako `skipped` s důvodem.
- **Kontrakt args.ts:** `--ai-check` je nový vstupní přepínač → otestovat jeho parsování
  reálným kódem (ne mockem). Vstupní body + kontrakty mezi moduly = před reportem pustit
  nezávislého sub-agenta (self-review čerstvým kontextem).
- **JSON index verze 11 → 12:** rozbíjející změna tvaru pro konzumenty strojového indexu
  (union `ai` dostává variantu `verified`).
- **Render:** `aiSection` i `aiSummaryLine` v `markdown.ts` potřebují větev pro `verified`.
- **Test „timeout":** mock SDK vyhodí timeout chybu, NE reálné čekání – jinak test trvá věčně.
- **`verified` držet minimální** (`{kind: "verified"}`); případné jméno modelu v reportu je
  nice-to-have, ne nutnost (rozhodnout v `plan`).
