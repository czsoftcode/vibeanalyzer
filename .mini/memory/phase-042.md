# Phase 42 — AI vrstva: reálný dotaz na Anthropic

**Goal:** Přidat @anthropic-ai/sdk; s klíčem poslat minimální testovací dotaz na levný model a při úspěchu označit AI stav jako 'ověřeno', při síťové chybě/timeoutu čistě přeskočit s konkrétním důvodem; hláška o chybějícím klíči řekne, jak ho nastavit (env, žádný dotenv); detekci klíče nechat čistou a synchronní, reálný dotaz v samostatné async funkci; úzký catch jen na síť/timeout (programová chyba nesmí spadnout pod 'přeskočeno'); testy s mockem SDK pro úspěch, síťovou chybu i timeout.

## Steps
- [done] Přidat @anthropic-ai/sdk + modul reálného pingu
- [done] Rozšířit AiStatus o verified + async verifyAiAccess (DI) + unit testy
- [done] Přepínač --ai-check do args.ts + test
- [done] Zapojit do cli.ts + stderr hláška o chybějícím klíči
- [done] Report: verified v JSON (verze 12) i markdownu + testy
- [done] Doběh: tsc + suite + reálné běhy + nezávislý sub-agent

## Auto-commit
- Phase 42: AI vrstva: reálný dotaz na Anthropic

## Discussion
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

## Run report
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
