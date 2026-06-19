# Phase 23 — Strojová bezpečnost: audit závislostí

**Goal:** Spustit npm audit --json jako podproces v analyzovaném projektu, převést zranitelné závislosti na strojové nálezy (balík, závažnost, CVE, dostupná oprava) a vykreslit je v reportu; bez sítě / bez package-lock.json / bez npm se vrstva čistě přeskočí (jako AI vrstva), ne spadne. Report rozliší 'čistý' vs 'přeskočeno'. Ošetřit timeout/izolaci jako u tsc/ESLint.

## Steps
- [done] Flagy --audit a --dev v args.ts
- [done] Spuštění npm audit izolovaně (temp kopie + sanitace + timeout)
- [done] Parser npm audit JSON -> nálezy (AuditResult)
- [done] Render auditu v reportu (md + JSON)
- [done] Napojení do CLI
- [done] End-to-end + nezávislý self-review

## Auto-commit
- Phase 23: Strojová bezpečnost: audit závislostí

## Discussion
# Phase 23 — Strojová bezpečnost: audit závislostí

## Intent
Pátý strojový pohled: zranitelné závislosti. Spustit `npm audit --json` nad analyzovaným projektem,
převést výsledek na strojové nálezy (balík@verze, závažnost, CVE/advisory, dostupná oprava) a vykreslit
v reportu vedle tsc/ESLint/tajemství. Druhá (a poslední) polovina backlog [4].

Tahle vrstva je VĚDOMĚ network-optional a OPT-IN – nepustí se sama. Tím se neporušuje slib „strojová
vrstva běží offline": výchozí běh zůstává offline, audit je explicitní volba uživatele.

## Key decisions
- **Opt-in přes `--audit` (rozhodnuto uživatelem):** audit běží JEN s `--audit`. Bez něj se sekce
  vykreslí jako „přeskočeno (audit nevyžádán)". Nový boolean flag v `args.ts`.
- **Rozsah dev/prod (rozhodnuto uživatelem):** `--audit` sám = jen produkční (`npm audit --omit=dev`).
  `--audit --dev` = prod i dev (bez omit). `--dev` BEZ `--audit` je neúčinný – ideálně jemná pozn. na
  stderr, ne tichý no-op (drobná unhappy-path větev).
- **Registry/hijack obrana (rozhodnuto uživatelem): vždy oficiální npm, ignorovat projektový `.npmrc`.**
  Doporučená implementace: npm NEspouštět v cizí složce vůbec. Zkopírovat jen `package.json` +
  `package-lock.json` (resp. `npm-shrinkwrap.json`) do DOČASNÉHO adresáře a audit pustit tam s
  `--registry=https://registry.npmjs.org/` a sanitovaným prostředím (smazat `npm_config_*`,
  `NPM_CONFIG_*`, `*_proxy`; případně `--userconfig`/`--globalconfig` na prázdno). Tím se cizí `.npmrc`
  ani proxy nikdy nepřečtou. Bonus: drží slib „čte, nespouští" striktněji (npm se cizího stromu netkne).
  Trade-off: projekt s legitimním privátním registry se nezaudituje – přijato.
- **Spuštění procesu:** `execFile`/`spawn` s timeoutem (`ANALYSIS_TIMEOUT_MS` z limits.ts). `runIsolated`
  se NEpoužije – ten forkuje JS modul, tady spouštíme externí `npm`.
- **Kontrakt nálezu:** rozšířit `FindingSource` o `"audit"` (sdílený union ve findings.ts). Závislost
  nemá místo v souboru → `file` = `"package-lock.json"` (kde je deklarovaná), `line`/`column` chybí
  (jako globální tsc chyby). `rule` = CVE/GHSA id, `message` = balík@rozsah + název advisory + „oprava:
  ano/ne" (BEZ příkazu k auto-fixu – non-goal). Severity mapping: critical/high → `error`,
  moderate → `warning`, low → `info`.
- **Výsledkový union:** `AuditResult = {kind:"skipped"; reason} | {kind:"ran"; findings; counts}` jako
  TscResult/EslintResult/SecretsResult. „ran s 0 nálezy" (čisto) se NESMÍ splést se „skipped".

## Watch out for
- **NENULOVÝ EXIT KÓD = past:** `npm audit` vrací nenulový exit, KDYŽ NAJDE zranitelnosti. Nesmí se brát
  jako selhání! Vždy parsovat JSON ze stdout bez ohledu na exit kód. „Selhání/skip" = chybí/nevalidní
  JSON nebo npm vůbec nešel spustit, NE nenulový kód. (Hlavní zub fáze – test musí pokrýt obojí.)
- **Závislost na lockfilu:** `npm audit --json` potřebuje `package-lock.json`/`npm-shrinkwrap.json`. Bez
  něj → skip s jasným důvodem. yarn.lock/pnpm-lock v1 NEpodporujeme (npm je nečte) → skip s důvodem.
- **Rozlišit důvody skipu** (jinak tichý falešný „čisto"): audit nevyžádán / není lockfile / není síť /
  npm chybí / timeout / nevalidní výstup. Report i JSON to musí říct konkrétně.
- **Formát `npm audit --json` v2** (`auditReportVersion: 2`): `vulnerabilities` je objekt keyovaný jménem
  balíku; každý má `severity`, `via` (pole advisory objektů NEBO jen jména – ošetřit obojí), `range`,
  `fixAvailable` (bool NEBO objekt), `isDirect`. Starší npm (v6) má jiný tvar – detekovat přes
  `auditReportVersion` a starý/neznámý tvar řešit jako skip, ne pád.
- **Síť/timeout:** cizí pomalý nebo nedostupný registry nesmí zaseknout běh → tvrdý timeout + zabití
  procesu; po timeoutu skip, ne pád. Úklid dočasného adresáře i při timeoutu/chybě (žádný osiřelý stav).
- **Non-goal kontrola:** `npm audit` NEspouští kód projektu (nečte postinstall skripty) → non-goal č. 1
  respektován. `--audit` je CLI flag, ne config soubor → non-goal o configu respektován. Žádný auto-fix,
  jen hlášení → non-goal o auto-fixu respektován.
- **Šum:** i s `--omit=dev` může být u velkého projektu hodně tranzitivních nálezů. Pro v1 vypsat všechny,
  neřešit stránkování/limit (případně jen poznámka o počtu).
- **Test bez sítě v CI:** test nesmí reálně volat síť. Injektovat běh npm (deps.runAudit) a krmit ho
  fixními JSON výstupy (s nálezy / čistý / nevalidní / nenulový exit), plus reálný malý e2e jen když je
  to bezpečné. Reálný `npm audit` v testu = flaky a síťově závislé.

## Run report
---
phase: 23
verdict: done
steps:
  - title: "Flagy --audit a --dev v args.ts"
    status: done
  - title: "Spuštění npm audit izolovaně (temp kopie + sanitace + timeout)"
    status: done
  - title: "Parser npm audit JSON -> nálezy (AuditResult)"
    status: done
  - title: "Render auditu v reportu (md + JSON)"
    status: done
  - title: "Napojení do CLI"
    status: done
  - title: "End-to-end + nezávislý self-review"
    status: done
---

# Phase 23 — report z auto session

## Co se udělalo
Pátý strojový pohled: audit závislostí přes `npm audit --json`. Nový `src/audit.ts`:
- **Runner** (`collectAuditOutput` + `runProcessForAudit` + `defaultNpmAuditRunner`): ověří
  `package.json` + lockfile, zkopíruje JE do **dočasného adresáře** a `npm audit` pustí TAM s vynuceným
  `--registry=npmjs.org` a sanitovaným prostředím (smaže `npm_config_*`/`*_proxy`). Cizí `.npmrc`/proxy se
  nikdy nepřečte (obrana proti hijacku, drží „čte, nespouští"). Temp dir se uklidí VŽDY (finally).
- **Parser** (`parseAuditJson`): z `auditReportVersion: 2` vyrobí `Finding[]` (`source:"audit"`,
  `file="package-lock.json"`, `rule`=GHSA, severity mapping critical/high→error, moderate→warning,
  low→info). Ošetřuje `via` string|objekt, `fixAvailable` bool|objekt|null, top-level `error` (síť),
  npm v6 (`advisories`) i nevalidní JSON → vždy `skipped` s konkrétním důvodem, ne pád.
- `FindingSource` += `"audit"`. `JsonIndex` nese `audit`, `INDEX_VERSION` 5→6. Report (md) má sekci
  „Strojové nálezy (závislosti)" + souhrnný řádek se třemi+ stavy.
- `args.ts`: flagy `--audit` (opt-in) a `--dev`. `cli.ts`: s `--audit` zavolá audit (předá `dev`), jinak
  `skipped "audit nevyžádán (--audit)"`; `--dev` bez `--audit` → pozn. na stderr. Defenzivní catch.

## Klíčová rozhodnutí (z diskuze, dodržena)
- Opt-in `--audit` → výchozí běh zůstává offline (neporušuje slib o strojové vrstvě bez sítě).
- `--audit` sám = jen prod (`--omit=dev`); `--audit --dev` = i dev.
- Izolace přes temp kopii lockfilu = obrana proti registry-hijacku z cizího `.npmrc`.

## Hlavní past (ověřeno)
`npm audit` vrací NENULOVÝ exit, když najde zranitelnosti. Runner to NEbere jako selhání – parsuje stdout
bez ohledu na exit kód. Testováno REÁLNÝM procesem (`node -e` se simulovaným exit 1 + stdout), ne jen
injektovaným outcome.

## Ověření (vše mnou, mechanicky)
- `npm run typecheck` čistý, `npm run build` projde, `npm test` = **39 souborů, 303 testů, zelené**
  (před fází 272). Nové testy: audit.run / audit.parse / cli.audit / report/markdown.audit + rozšířené args.
- Testy se zuby na obě strany: nález → report ho označí; čistý → „Žádné zranitelné závislosti"; skipy
  nesou konkrétní důvod. Bez sítě – runner i parser injektované, reálný `npm audit` se v testech nevolá.
- E2e přes `run()`: `--audit` s injektovaným nálezem → md i JSON ho mají; bez `--audit` → „přeskočeno
  (nevyžádán)" a audit se vůbec nezavolá; `--audit` bez lockfilu (reálný kód) → skip s důvodem, bez sítě.

## Nezávislý self-review (čerstvý sub-agent) a reakce
Našel **1 blocker** + chybějící test + 1 should-fix, VŠE opraveno:
1. **BLOCKER:** externí SIGKILL (OOM killer) se hlásil jako „timeout / pomalá síť" – lživý důvod skipu.
   Časový limit se teď pozná spolehlivě přes `err.killed === true`; externí signál dostal vlastní pravdivý
   důvod („ukončen signálem … možná docházela paměť").
2. Doplněn test, který tu díru hlídá (child se zabije sám SIGKILL → výsledek NESMÍ být timeout).
3. **should-fix:** přetečení `maxBuffer` (> 64 MB) dostalo explicitní větev s pravdivým důvodem místo
   matoucího „nevalidní JSON".
Sub-agent potvrdil jako OK: úklid temp dir při výjimce, sanitace env pro daný threat model, odolnost vůči
prototype pollution z JSON, smíšené `via`, defenzivní CLI catch, cross-module kontrakt.

## Vědomá omezení
- Jen npm lockfile (yarn/pnpm se přeskočí s důvodem). Jen `auditReportVersion: 2` (npm v7+); v6 → skip.
- Audit je síťový a odešle strom závislostí na oficiální npm registry – proto opt-in. Privátní registry se
  nezauditují (vynucujeme oficiální). To je vědomá cena za obranu proti hijacku.
- Windows: `execFile("npm")` a sémantika signálů se může lišit; projekt cílí Linux.
