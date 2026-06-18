---
phase: 10
verdict: done
steps:
  - title: "run() přijme injektované interaktivní závislosti"
    status: done
  - title: "Offer-flow při absent záměru"
    status: done
  - title: "Zpracování výsledku zápisu + použití v reportu"
    status: done
  - title: "Reálné ask + TTY gate v bin.ts"
    status: done
  - title: "Testy se zuby (offer flow přes injektovaný ask + homeDir)"
    status: done
  - title: "Adversariální self-review nezávislým sub-agentem + finální kontrola"
    status: done
# Ruční ověření živého TTY (nabídka, vyplnění, Ctrl-D uprostřed) potvrdil uživatel.
---

# Phase 10 — report z auto session

## Co vzniklo
- **`src/cli.ts`**: `run(argv, cwd, deps?)` s `RunDeps {ask, isInteractive, homeDir}` (DI, default = neinteraktivní → žádná regrese). Nové helpery `offerIntentCreation` + `isYes`. Při `intentResult.kind==='absent'` && interaktivní && `ask` → nabídka `[a/N]` → `collectIntentDraft` → `renderProjectMd` → `writeIntentFile`; výsledek (`written`/`exists`/`unwritable`/`no-home`/`cancelled`) namapován na hlášku a `Intent|null`. `written` → záměr se použije i pro TENHLE report. Vytvoření NIKDY neshodí běh (report vznikne, exit 0).
- **`src/readlineAsk.ts`** (nový): `createReadlineAsk(input, output)` – most na readline vytažený z bin.ts kvůli testovatelnosti (viz review níž).
- **`src/bin.ts`**: TTY gate `stdin.isTTY && stdout.isTTY`; v ne-TTY dotazovač vůbec nevznikne → `isInteractive=false`, žádný hang.
- **Testy**: `cli.intent-offer.test.ts` (8 – celý offer flow přes injektovaný ask + homeDir) a `readlineAsk.test.ts` (7 – glue nad PassThrough). Stávající `cli.test.ts`/`cli.entrypoint.test.ts` upraveny/zachovány.

## Ověřeno mechanicky (sám)
- `npm run typecheck` čistý, `npm test` **149/149**.
- Ne-TTY běh přes `tsx … < /dev/null`: vypsal Tip (ne nabídku), report vznikl, exit 0, **neviselo** (klíčové tvrzení fáze).
- Offer flow testy se zuby: ano→soubor v injektovaném home + report má 'Záměr projektu'; READ-ONLY (do projektu se nic nezapíše); odmítnutí→Tip+žádný zápis; EOF→zrušeno bez zápisu; `isInteractive=false`→ani se nezeptá; `no-home`→hláška; **TOCTOU exists/unwritable** přes side-effect v ask (root-safe, deterministické).

## Adversariální review (nezávislý sub-agent) — našel a OPRAVENO
Blocker žádný. Dva should-know na PRÁVĚ změněné glue v bin.ts:
1. **`ask` po EOF házel `ERR_USE_AFTER_CLOSE`** (synchronně z `rl.question` na zavřeném rozhraní) → místo `null` by probublal pád s exit 1. Dnes nedosažitelné (sběr po null už `ask` nevolá), ale křehká nevyřčená invarianta v glue, ne obrana.
2. **Glue v bin.ts neměla žádný test** – přitom je to nejrizikovější změněná část (hang, race close↔question).

**Oprava (obojí najednou)**: glue vytažena do `readlineAsk.ts` s try/catch kolem `question` (po close → `null`, ne pád) a otestována nad PassThrough streamy (odpověď vs EOF, CRLF, dotaz po EOF→null, pořadí, close bez dotazu). bin.ts ztenčen. Tím je invarianta "po null vrátím zas null" vynucená v glue, ne spoléhaná na volajícího. (Vedlejší dopad: launcher test v `cli.entrypoint.test.ts` musel podvrhnout i `readlineAsk.js`, jinak ESM resolve padal – doplněno.)

Zbytek sub-agent potvrdil OK: exit kódy všech větví (report vždy vznikne, exit 0), read-only kontrakt (zápis jen do home), vyčerpávající switch, TTY gate, konzistence zapsaného vs zobrazeného záměru.

## Stav fáze
Bývalé todo 13 je tím funkčně hotové: nástroj v interaktivním běhu bez záměru nabídne jeho vytvoření, uloží ho do domova a rovnou použije. Drobné rozhodnutí (nabízet jen u `absent`, ne u prázdného skeletonu; `[a/N]` default Ne) je v komentářích kódu – spíš návrhová volba než plnohodnotný ADR.
